import db from "../db.server";

export type InvoiceSettingsRecord = {
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

let ensureTablesPromise: Promise<void> | null = null;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeStorefrontLang(value: unknown): string {
  const raw = asString(value).replace("_", "-").toLowerCase();
  return raw;
}

function normalizeInvoiceLocale(value: unknown): string {
  const raw = normalizeStorefrontLang(value);
  if (!raw) return "en";
  if (raw.startsWith("et")) return "et";
  return "en";
}

async function ensureInvoiceSettingsTables() {
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

export async function getInvoiceSettings(shop: string): Promise<InvoiceSettingsRecord | null> {
  const normalizedShop = asString(shop);
  if (!normalizedShop) return null;

  await ensureInvoiceSettingsTables();
  const rows = await db.$queryRawUnsafe<InvoiceSettingsRecord[]>(
    `SELECT * FROM "InvoiceSettings" WHERE "shop" = ? LIMIT 1`,
    normalizedShop,
  );
  return rows?.[0] || null;
}

export async function resolveInvoiceLocale(shop: string, storefrontLang: unknown): Promise<"en" | "et"> {
  const normalizedShop = asString(shop);
  const normalizedLang = normalizeStorefrontLang(storefrontLang);
  const defaultLocale = normalizeInvoiceLocale(normalizedLang);

  if (!normalizedShop) {
    return defaultLocale as "en" | "et";
  }

  await ensureInvoiceSettingsTables();

  if (normalizedLang) {
    const mapped = await db.$queryRawUnsafe<Pick<InvoiceLocaleMappingRecord, "invoiceLocale">[]>(
      `
      SELECT "invoiceLocale"
      FROM "InvoiceLocaleMapping"
      WHERE "shop" = ? AND "storefrontLang" = ?
      LIMIT 1
      `,
      normalizedShop,
      normalizedLang,
    );
    if (mapped?.[0]?.invoiceLocale) {
      return normalizeInvoiceLocale(mapped[0].invoiceLocale) as "en" | "et";
    }
  }

  const settings = await getInvoiceSettings(normalizedShop);
  if (settings?.defaultLocale) {
    return normalizeInvoiceLocale(settings.defaultLocale) as "en" | "et";
  }

  return defaultLocale as "en" | "et";
}
