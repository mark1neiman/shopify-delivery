import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { verifyInvoiceAccessToken } from "../services/invoice-access.server";

type InvoiceDocumentRecord = {
  id: string;
  shop: string;
  status: string;
  pdfStorageType: string | null;
  pdfStorageKey: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeFilename(value: string): string {
  return value.replace(/["\\\r\n]+/g, "_").trim();
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const documentId = asString(params.documentId);
  const url = new URL(request.url);
  const token = asString(url.searchParams.get("t"));
  const downloadParam = asString(url.searchParams.get("download")).toLowerCase();
  const forceDownload = downloadParam === "1" || downloadParam === "true" || downloadParam === "yes";
  if (!documentId || !token) {
    return new Response("Not found", { status: 404 });
  }

  const rows = await db.$queryRawUnsafe<InvoiceDocumentRecord[]>(
    `
    SELECT "id", "shop", "status", "pdfStorageType", "pdfStorageKey"
    FROM "InvoiceDocument"
    WHERE "id" = ?
    LIMIT 1
    `,
    documentId,
  );
  const document = rows?.[0] || null;
  const storageType = asString(document?.pdfStorageType);
  const storageKey = asString(document?.pdfStorageKey);
  if (!document || storageType !== "local-file" || !storageKey || asString(document.status) === "failed") {
    return new Response("Not found", { status: 404 });
  }

  const allowed = verifyInvoiceAccessToken({
    token,
    documentId: document.id,
    shop: document.shop,
    storageKey,
  });
  if (!allowed) {
    return new Response("Forbidden", { status: 403 });
  }

  const rootDir = asString(process.env.INVOICE_PDF_DIR) || "/tmp/shopify-delivery-invoices";
  const absolutePath = path.join(rootDir, storageKey);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await readFile(absolutePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const filename = sanitizeFilename(path.basename(storageKey) || `${document.id}.pdf`);
  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
