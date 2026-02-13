import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getCustomerSavedProducts,
  getLoggedInCustomerGidFromProxyRequest,
  normalizeSavedProductId,
  normalizeSavedProductItems,
  setCustomerSavedProducts,
  SavedProductsError,
  type SavedProductItem,
} from "../services/customer-saved-products.server";

function json(data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

type UpdatePayload = {
  action?: "toggle" | "add" | "remove" | "replace";
  item?: Partial<SavedProductItem> | null;
  id?: string | number | null;
  items?: Partial<SavedProductItem>[] | null;
};

function withItemFirst(items: SavedProductItem[], item: SavedProductItem) {
  const out = [item, ...items.filter((x) => x.id !== item.id)];
  return normalizeSavedProductItems(out);
}

function withItemRemoved(items: SavedProductItem[], id: string) {
  return normalizeSavedProductItems(items.filter((x) => x.id !== id));
}

async function resolveContext(request: Request) {
  let ctx: Awaited<ReturnType<typeof authenticate.public.appProxy>>;
  try {
    ctx = await authenticate.public.appProxy(request);
  } catch (error: any) {
    return {
      ok: false as const,
      response: json(
        {
          error: "Invalid app proxy signature or request context.",
          code: "APP_PROXY_AUTH_FAILED",
          detail: String(error?.message || error),
        },
        { status: 401 },
      ),
    };
  }

  if (!ctx.session) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "App proxy session is unavailable. Open the app in Admin once to refresh the session.",
          code: "APP_SESSION_MISSING",
        },
        { status: 503 },
      ),
    };
  }

  const customerGid = getLoggedInCustomerGidFromProxyRequest(request);
  if (!customerGid) {
    return {
      ok: false as const,
      response: json({ error: "Login required", code: "AUTH_REQUIRED" }, { status: 401 }),
    };
  }

  const url = new URL(request.url);
  const shop = String(url.searchParams.get("shop") || ctx.session.shop || "").trim();
  if (!shop) {
    return {
      ok: false as const,
      response: json({ error: "Missing shop in app proxy request", code: "MISSING_SHOP" }, { status: 400 }),
    };
  }

  return {
    ok: true as const,
    shop,
    customerGid,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const resolved = await resolveContext(request);
  if (!resolved.ok) return resolved.response;

  try {
    const items = await getCustomerSavedProducts(resolved.shop, resolved.customerGid);
    return json({ ok: true, items });
  } catch (error: any) {
    console.error("[saved-products] loader error", error);
    if (error instanceof SavedProductsError) {
      return json(
        { error: error.message, code: error.code, detail: error.detail ?? null },
        { status: error.status || 500 },
      );
    }
    return json({ error: "Failed to load saved products" }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const resolved = await resolveContext(request);
  if (!resolved.ok) return resolved.response;

  let payload: UpdatePayload;
  try {
    payload = (await request.json()) as UpdatePayload;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const current = await getCustomerSavedProducts(resolved.shop, resolved.customerGid);

    const action = String(payload?.action || "toggle").toLowerCase();
    const normalizedItem = normalizeSavedProductItems(payload?.item ? [payload.item] : [])[0] || null;
    const normalizedId = normalizeSavedProductId(payload?.id ?? normalizedItem?.id);

    let next: SavedProductItem[] = current;

    if (action === "replace") {
      next = normalizeSavedProductItems(payload?.items ?? []);
    } else if (action === "add") {
      if (!normalizedItem) return json({ error: "Invalid item" }, { status: 400 });
      next = withItemFirst(current, normalizedItem);
    } else if (action === "remove") {
      if (!normalizedId) return json({ error: "Invalid id" }, { status: 400 });
      next = withItemRemoved(current, normalizedId);
    } else {
      if (!normalizedItem) return json({ error: "Invalid item" }, { status: 400 });
      const exists = current.some((x) => x.id === normalizedItem.id);
      next = exists ? withItemRemoved(current, normalizedItem.id) : withItemFirst(current, normalizedItem);
    }

    const items = await setCustomerSavedProducts(resolved.shop, resolved.customerGid, next);
    return json({ ok: true, items });
  } catch (error: any) {
    console.error("[saved-products] action error", error);
    if (error instanceof SavedProductsError) {
      return json(
        { error: error.message, code: error.code, detail: error.detail ?? null },
        { status: error.status || 500 },
      );
    }
    return json({ error: "Failed to update saved products" }, { status: 500 });
  }
}
