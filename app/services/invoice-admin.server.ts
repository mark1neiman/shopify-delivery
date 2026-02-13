import { randomUUID } from "node:crypto";
import db from "../db.server";
import { normalizeStorefrontLang } from "./invoice-settings.server";

export type InvoiceLocale = "en" | "et";

export type InvoiceAdminSettings = {
  id: string;
  shop: string;
  triggerTopic: string;
  enabled: number | boolean;
  defaultLocale: string;
  fromName: string | null;
  fromEmail: string | null;
  replyToEmail: string | null;
  emailSubjectEn: string | null;
  emailSubjectEt: string | null;
  emailBodyEn: string | null;
  emailBodyEt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceLocaleMappingRecord = {
  id: string;
  shop: string;
  storefrontLang: string;
  invoiceLocale: string;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceTemplateRecord = {
  id: string;
  shop: string;
  locale: string;
  name: string;
  description: string | null;
  activeVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  activeVersion: number | null;
  activeHtml: string | null;
  activeCss: string | null;
  activeIsPublished: number | boolean | null;
};

export type InvoiceTemplateVersionRecord = {
  id: string;
  templateId: string;
  version: number;
  isPublished: number | boolean;
  html: string;
  css: string | null;
  tokensJson: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertInvoiceSettingsInput = {
  enabled: boolean;
  defaultLocale: InvoiceLocale;
};

export type CreateInvoiceTemplateInput = {
  locale: InvoiceLocale;
  name: string;
  description?: string | null;
};

export type CreateTemplateVersionInput = {
  templateId: string;
  html: string;
  css?: string | null;
  tokensJson?: string | null;
  createdBy?: string | null;
  publish?: boolean;
  setActive?: boolean;
};

export type UpsertLocaleMappingInput = {
  storefrontLang: string;
  invoiceLocale: InvoiceLocale;
  templateId?: string | null;
};

let ensureTablesPromise: Promise<void> | null = null;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInvoiceLocale(value: unknown): InvoiceLocale {
  const raw = asString(value).toLowerCase();
  return raw.startsWith("et") ? "et" : "en";
}

function normalizeTemplateName(value: unknown): string {
  return asString(value).slice(0, 120);
}

function normalizeDescription(value: unknown): string {
  return asString(value).slice(0, 500);
}

function normalizeTemplateId(value: unknown): string {
  return asString(value);
}

export async function ensureInvoiceAdminTables() {
  if (ensureTablesPromise) return ensureTablesPromise;

  ensureTablesPromise = (async () => {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InvoiceSettings" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "shop" TEXT NOT NULL,
        "triggerTopic" TEXT NOT NULL DEFAULT 'orders/create',
        "enabled" BOOLEAN NOT NULL DEFAULT false,
        "defaultLocale" TEXT NOT NULL DEFAULT 'en',
        "fromName" TEXT,
        "fromEmail" TEXT,
        "replyToEmail" TEXT,
        "emailSubjectEn" TEXT,
        "emailSubjectEt" TEXT,
        "emailBodyEn" TEXT,
        "emailBodyEt" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )
    `);

    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceSettings_shop_key"
      ON "InvoiceSettings"("shop")
    `);

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InvoiceTemplate" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "shop" TEXT NOT NULL,
        "locale" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "activeVersionId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )
    `);

    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceTemplate_shop_locale_name_key"
      ON "InvoiceTemplate"("shop", "locale", "name")
    `);

    await db.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "InvoiceTemplate_shop_locale_idx"
      ON "InvoiceTemplate"("shop", "locale")
    `);

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InvoiceTemplateVersion" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "templateId" TEXT NOT NULL,
        "version" INTEGER NOT NULL,
        "isPublished" BOOLEAN NOT NULL DEFAULT false,
        "html" TEXT NOT NULL,
        "css" TEXT,
        "tokensJson" TEXT,
        "createdBy" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )
    `);

    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceTemplateVersion_templateId_version_key"
      ON "InvoiceTemplateVersion"("templateId", "version")
    `);

    await db.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "InvoiceTemplateVersion_templateId_isPublished_idx"
      ON "InvoiceTemplateVersion"("templateId", "isPublished")
    `);

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InvoiceLocaleMapping" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "shop" TEXT NOT NULL,
        "storefrontLang" TEXT NOT NULL,
        "invoiceLocale" TEXT NOT NULL,
        "templateId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )
    `);

    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceLocaleMapping_shop_storefrontLang_key"
      ON "InvoiceLocaleMapping"("shop", "storefrontLang")
    `);
  })().catch((error) => {
    ensureTablesPromise = null;
    throw error;
  });

  return ensureTablesPromise;
}

export async function getInvoiceAdminSettings(shop: string): Promise<InvoiceAdminSettings | null> {
  const normalizedShop = asString(shop);
  if (!normalizedShop) return null;

  await ensureInvoiceAdminTables();
  const rows = await db.$queryRawUnsafe<InvoiceAdminSettings[]>(
    `SELECT * FROM "InvoiceSettings" WHERE "shop" = ? LIMIT 1`,
    normalizedShop,
  );
  return rows?.[0] || null;
}

export async function upsertInvoiceAdminSettings(shop: string, input: UpsertInvoiceSettingsInput) {
  const normalizedShop = asString(shop);
  if (!normalizedShop) throw new Error("upsertInvoiceAdminSettings: missing shop");

  await ensureInvoiceAdminTables();

  const existing = await getInvoiceAdminSettings(normalizedShop);
  const nowIso = new Date().toISOString();
  const defaultLocale = normalizeInvoiceLocale(input.defaultLocale);

  if (!existing) {
    await db.$executeRawUnsafe(
      `
      INSERT INTO "InvoiceSettings" (
        "id", "shop", "triggerTopic", "enabled", "defaultLocale", "fromName", "fromEmail", "replyToEmail",
        "emailSubjectEn", "emailSubjectEt", "emailBodyEn", "emailBodyEt", "createdAt", "updatedAt"
      )
      VALUES (?, ?, 'orders/create', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
      `,
      randomUUID(),
      normalizedShop,
      input.enabled ? 1 : 0,
      defaultLocale,
      null,
      null,
      null,
      nowIso,
      nowIso,
    );
  } else {
    await db.$executeRawUnsafe(
      `
      UPDATE "InvoiceSettings"
      SET
        "enabled" = ?,
        "defaultLocale" = ?,
        "fromName" = ?,
        "fromEmail" = ?,
        "replyToEmail" = ?,
        "updatedAt" = ?
      WHERE "shop" = ?
      `,
      input.enabled ? 1 : 0,
      defaultLocale,
      existing.fromName || null,
      existing.fromEmail || null,
      existing.replyToEmail || null,
      nowIso,
      normalizedShop,
    );
  }
}

export async function listInvoiceTemplates(shop: string): Promise<InvoiceTemplateRecord[]> {
  const normalizedShop = asString(shop);
  if (!normalizedShop) return [];

  await ensureInvoiceAdminTables();
  return db.$queryRawUnsafe<InvoiceTemplateRecord[]>(
    `
    SELECT
      t."id",
      t."shop",
      t."locale",
      t."name",
      t."description",
      t."activeVersionId",
      t."createdAt",
      t."updatedAt",
      v."version" AS "activeVersion",
      v."html" AS "activeHtml",
      v."css" AS "activeCss",
      v."isPublished" AS "activeIsPublished"
    FROM "InvoiceTemplate" t
    LEFT JOIN "InvoiceTemplateVersion" v
      ON v."id" = t."activeVersionId"
    WHERE t."shop" = ?
    ORDER BY t."locale" ASC, t."name" ASC
    `,
    normalizedShop,
  );
}

export async function getInvoiceTemplate(
  shop: string,
  templateId: string,
): Promise<InvoiceTemplateRecord | null> {
  const normalizedShop = asString(shop);
  const normalizedTemplateId = normalizeTemplateId(templateId);
  if (!normalizedShop || !normalizedTemplateId) return null;

  await ensureInvoiceAdminTables();
  const rows = await db.$queryRawUnsafe<InvoiceTemplateRecord[]>(
    `
    SELECT
      t."id",
      t."shop",
      t."locale",
      t."name",
      t."description",
      t."activeVersionId",
      t."createdAt",
      t."updatedAt",
      v."version" AS "activeVersion",
      v."html" AS "activeHtml",
      v."css" AS "activeCss",
      v."isPublished" AS "activeIsPublished"
    FROM "InvoiceTemplate" t
    LEFT JOIN "InvoiceTemplateVersion" v
      ON v."id" = t."activeVersionId"
    WHERE t."shop" = ? AND t."id" = ?
    LIMIT 1
    `,
    normalizedShop,
    normalizedTemplateId,
  );
  return rows?.[0] || null;
}

export async function createInvoiceTemplate(shop: string, input: CreateInvoiceTemplateInput): Promise<string> {
  const normalizedShop = asString(shop);
  const locale = normalizeInvoiceLocale(input.locale);
  const name = normalizeTemplateName(input.name);
  const description = normalizeDescription(input.description);
  if (!normalizedShop || !name) {
    throw new Error("createInvoiceTemplate: missing required fields");
  }

  await ensureInvoiceAdminTables();
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  await db.$executeRawUnsafe(
    `
    INSERT INTO "InvoiceTemplate" (
      "id", "shop", "locale", "name", "description", "activeVersionId", "createdAt", "updatedAt"
    )
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `,
    id,
    normalizedShop,
    locale,
    name,
    description || null,
    nowIso,
    nowIso,
  );
  return id;
}

export async function listInvoiceTemplateVersions(templateId: string): Promise<InvoiceTemplateVersionRecord[]> {
  const normalizedTemplateId = normalizeTemplateId(templateId);
  if (!normalizedTemplateId) return [];

  await ensureInvoiceAdminTables();
  return db.$queryRawUnsafe<InvoiceTemplateVersionRecord[]>(
    `
    SELECT *
    FROM "InvoiceTemplateVersion"
    WHERE "templateId" = ?
    ORDER BY "version" DESC
    `,
    normalizedTemplateId,
  );
}

export async function setInvoiceTemplateActiveVersion(
  shop: string,
  templateId: string,
  versionId: string,
) {
  const normalizedShop = asString(shop);
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const normalizedVersionId = asString(versionId);
  if (!normalizedShop || !normalizedTemplateId || !normalizedVersionId) {
    throw new Error("setInvoiceTemplateActiveVersion: missing required fields");
  }

  await ensureInvoiceAdminTables();
  const nowIso = new Date().toISOString();
  await db.$executeRawUnsafe(
    `
    UPDATE "InvoiceTemplate"
    SET "activeVersionId" = ?, "updatedAt" = ?
    WHERE "shop" = ? AND "id" = ?
    `,
    normalizedVersionId,
    nowIso,
    normalizedShop,
    normalizedTemplateId,
  );
}

export async function createInvoiceTemplateVersion(
  shop: string,
  input: CreateTemplateVersionInput,
): Promise<{ versionId: string; version: number }> {
  const normalizedShop = asString(shop);
  const templateId = normalizeTemplateId(input.templateId);
  const html = asString(input.html);
  const css = asString(input.css);
  const tokensJson = asString(input.tokensJson);
  if (!normalizedShop || !templateId || !html) {
    throw new Error("createInvoiceTemplateVersion: missing required fields");
  }

  await ensureInvoiceAdminTables();

  const template = await getInvoiceTemplate(normalizedShop, templateId);
  if (!template) {
    throw new Error("Template not found");
  }

  const versionRows = await db.$queryRawUnsafe<{ maxVersion: number | null }[]>(
    `SELECT MAX("version") AS "maxVersion" FROM "InvoiceTemplateVersion" WHERE "templateId" = ?`,
    templateId,
  );
  const nextVersion = (Number(versionRows?.[0]?.maxVersion) || 0) + 1;
  const versionId = randomUUID();
  const nowIso = new Date().toISOString();
  const publish = Boolean(input.publish);
  const setActive = input.setActive == null ? publish : Boolean(input.setActive);

  if (publish) {
    await db.$executeRawUnsafe(
      `UPDATE "InvoiceTemplateVersion" SET "isPublished" = 0, "updatedAt" = ? WHERE "templateId" = ?`,
      nowIso,
      templateId,
    );
  }

  await db.$executeRawUnsafe(
    `
    INSERT INTO "InvoiceTemplateVersion" (
      "id", "templateId", "version", "isPublished", "html", "css", "tokensJson", "createdBy", "createdAt", "updatedAt"
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    versionId,
    templateId,
    nextVersion,
    publish ? 1 : 0,
    html,
    css || null,
    tokensJson || null,
    asString(input.createdBy) || null,
    nowIso,
    nowIso,
  );

  if (setActive) {
    await setInvoiceTemplateActiveVersion(normalizedShop, templateId, versionId);
  }

  return { versionId, version: nextVersion };
}

export async function listInvoiceLocaleMappings(shop: string): Promise<InvoiceLocaleMappingRecord[]> {
  const normalizedShop = asString(shop);
  if (!normalizedShop) return [];

  await ensureInvoiceAdminTables();
  return db.$queryRawUnsafe<InvoiceLocaleMappingRecord[]>(
    `
    SELECT *
    FROM "InvoiceLocaleMapping"
    WHERE "shop" = ?
    ORDER BY "storefrontLang" ASC
    `,
    normalizedShop,
  );
}

export async function upsertInvoiceLocaleMapping(shop: string, input: UpsertLocaleMappingInput) {
  const normalizedShop = asString(shop);
  const storefrontLang = normalizeStorefrontLang(input.storefrontLang);
  const invoiceLocale = normalizeInvoiceLocale(input.invoiceLocale);
  const templateId = normalizeTemplateId(input.templateId);
  if (!normalizedShop || !storefrontLang) {
    throw new Error("upsertInvoiceLocaleMapping: missing required fields");
  }

  await ensureInvoiceAdminTables();

  if (templateId) {
    const template = await getInvoiceTemplate(normalizedShop, templateId);
    if (!template) {
      throw new Error("Selected template does not belong to this shop");
    }
  }

  const nowIso = new Date().toISOString();
  await db.$executeRawUnsafe(
    `
    INSERT INTO "InvoiceLocaleMapping" (
      "id", "shop", "storefrontLang", "invoiceLocale", "templateId", "createdAt", "updatedAt"
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT("shop", "storefrontLang")
    DO UPDATE SET
      "invoiceLocale" = excluded."invoiceLocale",
      "templateId" = excluded."templateId",
      "updatedAt" = excluded."updatedAt"
    `,
    randomUUID(),
    normalizedShop,
    storefrontLang,
    invoiceLocale,
    templateId || null,
    nowIso,
    nowIso,
  );
}

export async function deleteInvoiceLocaleMapping(shop: string, mappingId: string) {
  const normalizedShop = asString(shop);
  const id = asString(mappingId);
  if (!normalizedShop || !id) return;

  await ensureInvoiceAdminTables();
  await db.$executeRawUnsafe(
    `DELETE FROM "InvoiceLocaleMapping" WHERE "shop" = ? AND "id" = ?`,
    normalizedShop,
    id,
  );
}
