import db from "../db.server";

export type SavedProductItem = {
  id: string;
  url: string;
  title: string;
  image: string;
  price: string;
};

const MAX_ITEMS = 120;
const TABLE_NAME = "customer_saved_products";

export class SavedProductsError extends Error {
  code: string;
  status: number;
  detail?: unknown;

  constructor(message: string, code: string, status = 500, detail?: unknown) {
    super(message);
    this.name = "SavedProductsError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

type SavedProductsRow = {
  items_json: string | null;
};

let ensureTablePromise: Promise<void> | null = null;

async function ensureTable() {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    try {
      await db.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          shop TEXT NOT NULL,
          customer_id TEXT NOT NULL,
          items_json TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (shop, customer_id)
        )
      `);
    } catch (error: any) {
      ensureTablePromise = null;
      throw new SavedProductsError(
        "Failed to initialize saved products storage table",
        "DB_TABLE_INIT_FAILED",
        500,
        String(error?.message || error),
      );
    }
  })();

  return ensureTablePromise;
}

function customerStorageId(customerGidOrId: string): string {
  return normalizeSavedProductId(customerGidOrId);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSavedProductId(value: unknown): string {
  const raw = asString(value);
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return raw;

  const match = raw.match(/(\d+)(?!.*\d)/);
  return match ? match[1] : "";
}

function normalizeSavedProductItem(value: unknown): SavedProductItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;

  const id = normalizeSavedProductId(item.id);
  if (!id) return null;

  return {
    id,
    url: asString(item.url),
    title: asString(item.title),
    image: asString(item.image),
    price: asString(item.price),
  };
}

export function normalizeSavedProductItems(value: unknown): SavedProductItem[] {
  const raw = Array.isArray(value) ? value : [];
  const out: SavedProductItem[] = [];
  const seen = new Set<string>();

  for (const row of raw) {
    const item = normalizeSavedProductItem(row);
    if (!item) continue;
    if (seen.has(item.id)) continue;

    seen.add(item.id);
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }

  return out;
}

export function getLoggedInCustomerGidFromProxyRequest(request: Request): string | null {
  const url = new URL(request.url);
  const loggedInCustomerId = normalizeSavedProductId(url.searchParams.get("logged_in_customer_id"));
  if (!loggedInCustomerId) return null;
  return `gid://shopify/Customer/${loggedInCustomerId}`;
}

export async function getCustomerSavedProducts(shop: string, customerGidOrId: string): Promise<SavedProductItem[]> {
  const customerId = customerStorageId(customerGidOrId);
  if (!shop || !customerId) return [];

  await ensureTable();

  let rows: SavedProductsRow[] = [];
  try {
    rows = await db.$queryRawUnsafe<SavedProductsRow[]>(
      `SELECT items_json FROM ${TABLE_NAME} WHERE shop = ? AND customer_id = ? LIMIT 1`,
      shop,
      customerId,
    );
  } catch (error: any) {
    throw new SavedProductsError(
      "Failed to load saved products from database",
      "DB_READ_FAILED",
      500,
      String(error?.message || error),
    );
  }

  const value = rows?.[0]?.items_json;
  if (!value) return [];

  try {
    return normalizeSavedProductItems(JSON.parse(String(value)));
  } catch {
    return [];
  }
}

export async function setCustomerSavedProducts(
  shop: string,
  customerGidOrId: string,
  items: SavedProductItem[],
): Promise<SavedProductItem[]> {
  const customerId = customerStorageId(customerGidOrId);
  const normalized = normalizeSavedProductItems(items);
  if (!shop || !customerId) return normalized;

  await ensureTable();

  try {
    await db.$executeRawUnsafe(
      `
      INSERT INTO ${TABLE_NAME} (shop, customer_id, items_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(shop, customer_id)
      DO UPDATE SET items_json = excluded.items_json, updated_at = CURRENT_TIMESTAMP
      `,
      shop,
      customerId,
      JSON.stringify(normalized),
    );
  } catch (error: any) {
    throw new SavedProductsError(
      "Failed to save products to database",
      "DB_WRITE_FAILED",
      500,
      String(error?.message || error),
    );
  }

  return normalized;
}
