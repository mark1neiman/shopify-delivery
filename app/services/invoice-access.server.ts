import { createHmac, timingSafeEqual } from "node:crypto";

type InvoiceAccessTokenInput = {
  documentId: string;
  shop: string;
  storageKey: string;
  ttlSeconds?: number;
};

type VerifyInvoiceAccessTokenInput = {
  token: string;
  documentId: string;
  shop: string;
  storageKey: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function tokenSecret(): string {
  return asString(process.env.INVOICE_PUBLIC_TOKEN_SECRET) || asString(process.env.SHOPIFY_API_SECRET);
}

function tokenPayload(documentId: string, shop: string, storageKey: string, expiresAt: number): string {
  return `${documentId}.${shop}.${storageKey}.${expiresAt}`;
}

function signPayload(payload: string): string {
  const secret = tokenSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length === 0 || rightBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createInvoiceAccessToken(input: InvoiceAccessTokenInput): string {
  const documentId = asString(input.documentId);
  const shop = asString(input.shop);
  const storageKey = asString(input.storageKey);
  if (!documentId || !shop || !storageKey) return "";

  const ttlSeconds = Math.max(300, Math.floor(Number(input.ttlSeconds ?? 3600 * 24 * 365)));
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = tokenPayload(documentId, shop, storageKey, expiresAt);
  const signature = signPayload(payload);
  if (!signature) return "";
  return `${expiresAt}.${signature}`;
}

export function verifyInvoiceAccessToken(input: VerifyInvoiceAccessTokenInput): boolean {
  const token = asString(input.token);
  const documentId = asString(input.documentId);
  const shop = asString(input.shop);
  const storageKey = asString(input.storageKey);
  if (!token || !documentId || !shop || !storageKey) return false;

  const [expiresRaw, signatureRaw] = token.split(".", 2);
  const expiresAt = Number.parseInt(expiresRaw, 10);
  const signature = asString(signatureRaw).toLowerCase();
  if (!Number.isFinite(expiresAt) || expiresAt <= 0 || !/^[a-f0-9]{64}$/.test(signature)) {
    return false;
  }
  if (expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const payload = tokenPayload(documentId, shop, storageKey, expiresAt);
  const expected = signPayload(payload);
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return safeEqualHex(expected, signature);
}
