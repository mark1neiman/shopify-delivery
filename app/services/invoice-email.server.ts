import { spawn } from "node:child_process";

export type SendInvoiceEmailInput = {
  to: string;
  fromEmail: string;
  fromName?: string;
  replyToEmail?: string | null;
  subject: string;
  text: string;
  html?: string;
  attachmentFilename: string;
  attachmentContent: Buffer;
};

export type SendInvoiceEmailResult = {
  transport: "sendmail" | "resend" | "smtp";
  messageId: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeaderValue(value: string): string {
  const safe = sanitizeHeaderValue(value);
  if (!safe) return "";
  if (/^[\x20-\x7E]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

function formatAddressHeader(email: string, name?: string): string {
  const safeEmail = sanitizeHeaderValue(email);
  const safeName = encodeHeaderValue(asString(name));
  if (!safeName) return safeEmail;
  return `${safeName} <${safeEmail}>`;
}

function chunkString(input: string, size: number): string {
  if (!input) return "";
  const chunks: string[] = [];
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size));
  }
  return chunks.join("\r\n");
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}

function resendApiKey(): string {
  return asString(process.env.INVOICE_RESEND_API_KEY || process.env.RESEND_API_KEY || process.env.RESEND_TOKEN);
}

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function smtpConfigFromEnv(): SmtpConfig | null {
  const host = asString(process.env.INVOICE_SMTP_HOST || process.env.SMTP_HOST);
  const port = parsePort(asString(process.env.INVOICE_SMTP_PORT || process.env.SMTP_PORT));
  if (!host || !port) return null;

  const secureRaw = asString(process.env.INVOICE_SMTP_SECURE || process.env.SMTP_SECURE);
  const secure = secureRaw ? parseBoolean(secureRaw) : port === 465;
  const user = asString(process.env.INVOICE_SMTP_USER || process.env.SMTP_USER);
  const pass = asString(process.env.INVOICE_SMTP_PASS || process.env.SMTP_PASS);

  return { host, port, secure, user, pass };
}

async function sendViaResend(input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> {
  const apiKey = resendApiKey();
  if (!apiKey) {
    throw new Error("INVOICE_RESEND_API_KEY is missing for resend transport");
  }

  const from = formatAddressHeader(input.fromEmail, input.fromName);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      reply_to: asString(input.replyToEmail) || undefined,
      subject: input.subject,
      text: input.text,
      html: asString(input.html) || undefined,
      attachments: [
        {
          filename: input.attachmentFilename,
          content: input.attachmentContent.toString("base64"),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error ${response.status}: ${body || response.statusText}`);
  }

  const json = (await response.json()) as { id?: string };
  return {
    transport: "resend",
    messageId: asString(json.id) || null,
  };
}

async function sendViaSmtp(input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> {
  const config = smtpConfigFromEnv();
  if (!config) {
    throw new Error("SMTP transport is selected, but SMTP env vars are missing (INVOICE_SMTP_HOST/INVOICE_SMTP_PORT)");
  }

  let createTransport: ((options: unknown) => { sendMail: (message: unknown) => Promise<unknown> }) | null = null;
  try {
    const moduleName = "nodemailer";
    const mod = (await import(moduleName)) as {
      default?: { createTransport?: (options: unknown) => { sendMail: (message: unknown) => Promise<unknown> } };
      createTransport?: (options: unknown) => { sendMail: (message: unknown) => Promise<unknown> };
    };
    createTransport = mod.createTransport || mod.default?.createTransport || null;
  } catch {
    throw new Error("SMTP transport requires nodemailer package. Run: npm install nodemailer");
  }

  if (!createTransport) {
    throw new Error("SMTP transport is unavailable: nodemailer.createTransport not found");
  }

  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
  });

  const info = (await transporter.sendMail({
    from: formatAddressHeader(input.fromEmail, input.fromName),
    to: input.to,
    replyTo: asString(input.replyToEmail) || undefined,
    subject: input.subject,
    text: input.text,
    html: asString(input.html) || undefined,
    attachments: [
      {
        filename: input.attachmentFilename,
        content: input.attachmentContent,
      },
    ],
  })) as { messageId?: string };

  return {
    transport: "smtp",
    messageId: asString(info?.messageId) || null,
  };
}

function sendmailPath(): string {
  return asString(process.env.INVOICE_SENDMAIL_PATH) || "/usr/sbin/sendmail";
}

async function sendViaSendmail(input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> {
  const fromHeader = formatAddressHeader(input.fromEmail, input.fromName);
  const toHeader = sanitizeHeaderValue(input.to);
  const replyToHeader = sanitizeHeaderValue(asString(input.replyToEmail));
  const subjectHeader = encodeHeaderValue(input.subject);
  const boundary = `----invoice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const attachmentBase64 = chunkString(input.attachmentContent.toString("base64"), 76);
  const attachmentName = (sanitizeHeaderValue(input.attachmentFilename) || "invoice.pdf").replace(/["\\]/g, "");
  const attachmentNameUtf8 = encodeRfc5987(attachmentName);
  const textBody = input.text.replace(/\r?\n/g, "\r\n");
  const htmlBody = asString(input.html).replace(/\r?\n/g, "\r\n");

  const headers = [
    `From: ${fromHeader}`,
    `To: ${toHeader}`,
    replyToHeader ? `Reply-To: ${replyToHeader}` : "",
    `Subject: ${subjectHeader}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]
    .filter(Boolean)
    .join("\r\n");

  const message = [
    headers,
    "",
    `--${boundary}`,
    htmlBody ? 'Content-Type: text/html; charset="UTF-8"' : 'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    htmlBody || textBody,
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${attachmentName}"; name*=UTF-8''${attachmentNameUtf8}`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachmentName}"; filename*=UTF-8''${attachmentNameUtf8}`,
    "",
    attachmentBase64,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(sendmailPath(), ["-t", "-i"], { stdio: ["pipe", "ignore", "pipe"] });
    const stderr: string[] = [];

    child.on("error", (error) => {
      reject(new Error(`sendmail spawn failed: ${error.message}`));
    });

    child.stderr.on("data", (chunk) => {
      stderr.push(String(chunk));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const rawError = stderr.join("").trim() || `sendmail exited with code ${code}`;
      const errorMessage =
        /postfix\/main\.cf/i.test(rawError) || /sendmail:\s*fatal:/i.test(rawError)
          ? `${rawError}. Configure SMTP (INVOICE_SMTP_*) or INVOICE_RESEND_API_KEY, or configure sendmail MTA.`
          : rawError;
      reject(new Error(errorMessage));
    });

    child.stdin.write(message);
    child.stdin.end();
  });

  return {
    transport: "sendmail",
    messageId: null,
  };
}

function resolveTransport(): "sendmail" | "resend" | "smtp" {
  const explicit = asString(process.env.INVOICE_EMAIL_TRANSPORT).toLowerCase();
  if (explicit === "resend") return "resend";
  if (explicit === "sendmail") return "sendmail";
  if (explicit === "smtp") return "smtp";
  if (smtpConfigFromEnv()) return "smtp";
  if (resendApiKey()) return "resend";
  return "sendmail";
}

export async function sendInvoiceEmailWithAttachment(
  input: SendInvoiceEmailInput,
): Promise<SendInvoiceEmailResult> {
  const to = asString(input.to);
  const fromEmail = asString(input.fromEmail);
  const subject = asString(input.subject);
  const filename = asString(input.attachmentFilename);
  if (!to || !fromEmail || !subject || !filename || !Buffer.isBuffer(input.attachmentContent)) {
    throw new Error("sendInvoiceEmailWithAttachment: invalid input");
  }

  const normalizedInput: SendInvoiceEmailInput = {
    ...input,
    to,
    fromEmail,
    subject,
    attachmentFilename: filename,
  };

  const transport = resolveTransport();
  if (transport === "smtp") {
    return sendViaSmtp(normalizedInput);
  }
  if (transport === "resend") {
    return sendViaResend(normalizedInput);
  }
  return sendViaSendmail(normalizedInput);
}
