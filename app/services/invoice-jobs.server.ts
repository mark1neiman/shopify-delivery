import { randomUUID } from "node:crypto";
import db from "../db.server";

export type InvoiceJobStatus = "queued" | "processing" | "done" | "failed" | "skipped";

export type EnqueueInvoiceJobInput = {
  shop: string;
  triggerTopic?: string | null;
  orderId: string;
  orderName?: string | null;
  orderEmail?: string | null;
  orderLocale?: string | null;
  payload?: unknown;
};

export type InvoiceJobRecord = {
  id: string;
  shop: string;
  triggerTopic: string;
  orderId: string;
  orderName: string | null;
  orderEmail: string | null;
  orderLocale: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  payloadJson: string | null;
  lockedAt: string | null;
  lockOwner: string | null;
  runAfter: string | null;
  createdAt: string;
  updatedAt: string;
};

let ensureTablePromise: Promise<void> | null = null;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeOrderId(value: unknown): string {
  const raw = asString(value);
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return raw;

  const match = raw.match(/(\d+)(?!.*\d)/);
  return match ? match[1] : "";
}

export function normalizeLocale(value: unknown): string {
  const raw = asString(value).replace("_", "-").toLowerCase();
  if (!raw) return "";
  return raw;
}

function normalizeTriggerTopic(value: unknown): string {
  const raw = asString(value)
    .replace(/_/g, "/")
    .replace(/\s+/g, "");
  if (!raw) return "orders/create";
  return raw.toLowerCase();
}

async function ensureInvoiceJobsTable() {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InvoiceJob" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "shop" TEXT NOT NULL,
        "triggerTopic" TEXT NOT NULL,
        "orderId" TEXT NOT NULL,
        "orderName" TEXT,
        "orderEmail" TEXT,
        "orderLocale" TEXT,
        "status" TEXT NOT NULL DEFAULT 'queued',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "maxAttempts" INTEGER NOT NULL DEFAULT 5,
        "lastError" TEXT,
        "payloadJson" TEXT,
        "lockedAt" DATETIME,
        "lockOwner" TEXT,
        "runAfter" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )
    `);

    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceJob_shop_triggerTopic_orderId_key"
      ON "InvoiceJob"("shop", "triggerTopic", "orderId")
    `);

    await db.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "InvoiceJob_shop_status_runAfter_idx"
      ON "InvoiceJob"("shop", "status", "runAfter")
    `);
  })().catch((error) => {
    ensureTablePromise = null;
    throw error;
  });

  return ensureTablePromise;
}

export async function enqueueInvoiceJob(input: EnqueueInvoiceJobInput): Promise<{ id: string; created: boolean }> {
  const shop = asString(input.shop);
  const triggerTopic = normalizeTriggerTopic(input.triggerTopic);
  const orderId = normalizeOrderId(input.orderId);
  if (!shop || !orderId) {
    throw new Error("enqueueInvoiceJob: missing required shop or orderId");
  }

  await ensureInvoiceJobsTable();

  const id = randomUUID();
  const nowIso = new Date().toISOString();
  const payloadJson = input.payload == null ? null : JSON.stringify(input.payload);
  const orderLocale = normalizeLocale(input.orderLocale);

  await db.$executeRawUnsafe(
    `
    INSERT INTO "InvoiceJob" (
      "id", "shop", "triggerTopic", "orderId", "orderName", "orderEmail", "orderLocale",
      "status", "attempts", "maxAttempts", "lastError", "payloadJson", "lockedAt", "lockOwner", "runAfter",
      "createdAt", "updatedAt"
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, 5, NULL, ?, NULL, NULL, NULL, ?, ?)
    ON CONFLICT("shop", "triggerTopic", "orderId")
    DO UPDATE SET
      "orderName" = excluded."orderName",
      "orderEmail" = excluded."orderEmail",
      "status" = 'queued',
      "attempts" = 0,
      "lastError" = NULL,
      "runAfter" = NULL,
      "lockedAt" = NULL,
      "lockOwner" = NULL,
      "orderLocale" = CASE
        WHEN excluded."orderLocale" IS NOT NULL AND excluded."orderLocale" != ''
          THEN excluded."orderLocale"
        ELSE "InvoiceJob"."orderLocale"
      END,
      "payloadJson" = CASE
        WHEN excluded."payloadJson" IS NOT NULL
          THEN excluded."payloadJson"
        ELSE "InvoiceJob"."payloadJson"
      END,
      "updatedAt" = excluded."updatedAt"
    `,
    id,
    shop,
    triggerTopic,
    orderId,
    asString(input.orderName) || null,
    asString(input.orderEmail) || null,
    orderLocale || null,
    payloadJson,
    nowIso,
    nowIso,
  );

  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `
    SELECT "id"
    FROM "InvoiceJob"
    WHERE "shop" = ? AND "triggerTopic" = ? AND "orderId" = ?
    LIMIT 1
    `,
    shop,
    triggerTopic,
    orderId,
  );

  const finalId = rows?.[0]?.id || id;
  return { id: finalId, created: finalId === id };
}

export async function claimNextQueuedInvoiceJob(lockOwner: string, shop?: string): Promise<InvoiceJobRecord | null> {
  const owner = asString(lockOwner) || "invoice-worker";
  const normalizedShop = asString(shop);
  await ensureInvoiceJobsTable();

  const nowIso = new Date().toISOString();
  const queued = normalizedShop
    ? await db.$queryRawUnsafe<{ id: string }[]>(
        `
        SELECT "id"
        FROM "InvoiceJob"
        WHERE "shop" = ?
          AND "status" = 'queued'
          AND ("runAfter" IS NULL OR "runAfter" <= ?)
        ORDER BY "createdAt" ASC
        LIMIT 1
        `,
        normalizedShop,
        nowIso,
      )
    : await db.$queryRawUnsafe<{ id: string }[]>(
        `
        SELECT "id"
        FROM "InvoiceJob"
        WHERE "status" = 'queued'
          AND ("runAfter" IS NULL OR "runAfter" <= ?)
        ORDER BY "createdAt" ASC
        LIMIT 1
        `,
        nowIso,
      );
  const id = queued?.[0]?.id;
  if (!id) return null;
  return claimQueuedInvoiceJobById(id, owner);
}

async function claimQueuedInvoiceJobById(id: string, lockOwner: string): Promise<InvoiceJobRecord | null> {
  const owner = asString(lockOwner) || "invoice-worker";
  await ensureInvoiceJobsTable();
  const nowIso = new Date().toISOString();
  const updated = await db.$executeRawUnsafe(
    `
    UPDATE "InvoiceJob"
    SET
      "status" = 'processing',
      "attempts" = "attempts" + 1,
      "lockedAt" = ?,
      "lockOwner" = ?,
      "updatedAt" = ?
    WHERE "id" = ? AND "status" = 'queued'
    `,
    nowIso,
    owner,
    nowIso,
    id,
  );
  if (!updated) return null;

  const rows = await db.$queryRawUnsafe<InvoiceJobRecord[]>(
    `SELECT * FROM "InvoiceJob" WHERE "id" = ? LIMIT 1`,
    id,
  );
  return rows?.[0] || null;
}

export async function claimQueuedInvoiceJobByOrderId(
  lockOwner: string,
  shop: string,
  orderId: string,
): Promise<InvoiceJobRecord | null> {
  const owner = asString(lockOwner) || "invoice-worker";
  const normalizedShop = asString(shop);
  const normalizedOrderId = normalizeOrderId(orderId);
  if (!normalizedShop || !normalizedOrderId) return null;

  await ensureInvoiceJobsTable();
  const nowIso = new Date().toISOString();
  const queued = await db.$queryRawUnsafe<{ id: string }[]>(
    `
    SELECT "id"
    FROM "InvoiceJob"
    WHERE "shop" = ?
      AND "orderId" = ?
      AND "status" = 'queued'
      AND ("runAfter" IS NULL OR "runAfter" <= ?)
    ORDER BY "createdAt" DESC
    LIMIT 1
    `,
    normalizedShop,
    normalizedOrderId,
    nowIso,
  );

  const id = queued?.[0]?.id;
  if (!id) return null;
  return claimQueuedInvoiceJobById(id, owner);
}

export async function markInvoiceJobDone(id: string) {
  const jobId = asString(id);
  if (!jobId) return;
  await ensureInvoiceJobsTable();
  const nowIso = new Date().toISOString();
  await db.$executeRawUnsafe(
    `
    UPDATE "InvoiceJob"
    SET "status" = 'done', "lastError" = NULL, "lockedAt" = NULL, "lockOwner" = NULL, "updatedAt" = ?
    WHERE "id" = ?
    `,
    nowIso,
    jobId,
  );
}

export async function markInvoiceJobSkipped(id: string, reason?: string) {
  const jobId = asString(id);
  if (!jobId) return;
  await ensureInvoiceJobsTable();
  const nowIso = new Date().toISOString();
  await db.$executeRawUnsafe(
    `
    UPDATE "InvoiceJob"
    SET
      "status" = 'skipped',
      "lastError" = ?,
      "runAfter" = NULL,
      "lockedAt" = NULL,
      "lockOwner" = NULL,
      "updatedAt" = ?
    WHERE "id" = ?
    `,
    asString(reason) || null,
    nowIso,
    jobId,
  );
}

export async function markInvoiceJobFailed(id: string, errorMessage: string, retryDelaySeconds = 0) {
  const jobId = asString(id);
  if (!jobId) return;
  await ensureInvoiceJobsTable();

  const rows = await db.$queryRawUnsafe<{ attempts: number; maxAttempts: number }[]>(
    `SELECT "attempts", "maxAttempts" FROM "InvoiceJob" WHERE "id" = ? LIMIT 1`,
    jobId,
  );
  const row = rows?.[0];
  if (!row) return;

  const now = new Date();
  const nowIso = now.toISOString();
  const hasRetriesLeft = Number(row.attempts || 0) < Number(row.maxAttempts || 0);
  const retryAtIso = new Date(now.getTime() + Math.max(0, retryDelaySeconds) * 1000).toISOString();

  await db.$executeRawUnsafe(
    `
    UPDATE "InvoiceJob"
    SET
      "status" = ?,
      "lastError" = ?,
      "runAfter" = ?,
      "lockedAt" = NULL,
      "lockOwner" = NULL,
      "updatedAt" = ?
    WHERE "id" = ?
    `,
    hasRetriesLeft ? "queued" : "failed",
    asString(errorMessage) || "Unknown invoice job error",
    hasRetriesLeft ? retryAtIso : null,
    nowIso,
    jobId,
  );
}
