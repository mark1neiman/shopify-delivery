import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { adminGraphql } from "../shipping.server";
import { pricingEngine, type PricingInput } from "../services/pricing-engine.server";

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

type PreparePayload = {
  mode?: "preview" | "checkout";

  customerId?: string | null;
  promoCode?: string | null;
  freeChoiceVariantId?: string | null;

  // accept both
  lineItems?: { variantId: string | number; quantity: number }[];
  items?: { variantId: string | number; quantity: number }[];

  // (optional for checkout mode)
  draftOrderId?: string;
  email?: string;

  shippingAddress?: {
    name?: string;
    firstName?: string;
    lastName?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    countryCode?: string;
    phone?: string;
    company?: string;
  };

  delivery?: {
    title?: string;
    price?: string;
    currency?: string;
    provider?: string;
    pickupId?: string;
    pickupName?: string;
    pickupAddress?: string;
    country?: string;
  };

  attributes?: Record<string, string>;
};

function safeTrim(v: any) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function maskEmail(email: string) {
  const e = safeTrim(email);
  if (!e.includes("@")) return e ? "***" : "";
  const [u, d] = e.split("@");
  const u2 = u.length <= 2 ? `${u[0]}*` : `${u.slice(0, 2)}***`;
  return `${u2}@${d}`;
}

function maskPhone(phone: string) {
  const p = safeTrim(phone).replace(/\s+/g, " ");
  if (!p) return "";
  if (p.length <= 4) return "***";
  return `${p.slice(0, 4)}***`;
}

function toGid(variantId: string | number) {
  const raw = String(variantId).trim();
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/ProductVariant/${raw}`;
}

function isDraftOrderGid(id: string) {
  return /^gid:\/\/shopify\/DraftOrder\/\d+$/.test(id);
}

function splitName(fullName?: string) {
  const s = (fullName || "").trim().replace(/\s+/g, " ");
  if (!s) return { firstName: "", lastName: "" };
  const parts = s.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function parseDecimalPrice(price?: string) {
  if (!price) return null;
  const match = String(price).match(/[\d.,]+/);
  if (!match) return null;
  const normalized = match[0].replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

export async function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const ctx = await authenticate.public.appProxy(request);
  if (!ctx.session) {
    return json(
      {
        error:
          "App proxy session is unavailable. Open the app in Admin once to refresh the session.",
      },
      { status: 401 },
    );
  }

  let payload: PreparePayload;
  try {
    payload = (await request.json()) as PreparePayload;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode = payload.mode || "preview";

  const rawItems = (payload.lineItems ?? payload.items ?? [])
    .filter((item) => item?.variantId && item?.quantity)
    .map((item) => ({
      variantId: toGid(item.variantId),
      quantity: Number(item.quantity),
    }))
    .filter((x) => Number.isFinite(x.quantity) && x.quantity > 0);

  // ---- server log (masked) ----
  try {
    console.log("[prepare] incoming payload (masked)", {
      mode,
      customerId: payload.customerId ? "***" : null,
      promoCode: payload.promoCode ? "***" : null,
      freeChoiceVariantId: payload.freeChoiceVariantId ? "***" : null,
      lineItemsCount: payload.lineItems?.length || 0,
      itemsCount: payload.items?.length || 0,
      normalizedItemsCount: rawItems.length,
      email: maskEmail(safeTrim(payload.email)),
      shippingAddress: {
        name: safeTrim(payload.shippingAddress?.name),
        address1: safeTrim(payload.shippingAddress?.address1),
        city: safeTrim(payload.shippingAddress?.city),
        zip: safeTrim(payload.shippingAddress?.zip),
        countryCode: safeTrim(payload.shippingAddress?.countryCode),
        phone: maskPhone(safeTrim(payload.shippingAddress?.phone)),
      },
      hasDelivery: !!payload.delivery,
      attributesKeys: Object.keys(payload.attributes || {}),
    });
  } catch {}

  if (rawItems.length === 0) {
    return json({ error: "No line items" }, { status: 400 });
  }

  // 1) ALWAYS compute pricing (this is what cart.js expects)
  let pricing;
  try {
    const pricingInput: PricingInput = {
      items: rawItems.map((x) => ({ variantId: x.variantId, quantity: x.quantity })),
      customerId: payload.customerId ?? null,
      promoCode: payload.promoCode ?? null,
      freeChoiceVariantId: payload.freeChoiceVariantId ?? null,
    };

    pricing = await pricingEngine(ctx.admin, pricingInput);
  } catch (e: any) {
    console.error("[prepare] pricingEngine error:", e);
    return json({ error: "Pricing engine failed" }, { status: 500 });
  }

  // Preview mode: DO NOT create draft orders
  if (mode === "preview") {
    return json({ pricing });
  }

  // 2) Checkout mode (optional): create/update DraftOrder using pricing.lines
  // so freebies etc are included.
  const lineItemsInput = (pricing?.lines ?? [])
    .map((l: any) => ({ variantId: toGid(l.variantId), quantity: Number(l.quantity || 0) }))
    .filter((x: any) => x.variantId && Number.isFinite(x.quantity) && x.quantity > 0);

  if (!lineItemsInput.length) {
    return json({ error: "No line items after pricing" }, { status: 400 });
  }

  const customAttributes: { key: string; value: string }[] = [];
  if (payload.attributes) {
    for (const [key, value] of Object.entries(payload.attributes)) {
      if (value === null || value === undefined) continue;
      const v = String(value).trim();
      if (!v) continue;
      customAttributes.push({ key, value: v });
    }
  }

  const shippingAddressInput: any = {};
  const sa = payload.shippingAddress;
  if (sa && Object.values(sa).some(Boolean)) {
    const fromName = splitName(sa.name);
    const firstName = safeTrim(sa.firstName || fromName.firstName);
    const lastName = safeTrim(sa.lastName || fromName.lastName);

    if (firstName) shippingAddressInput.firstName = firstName;
    if (lastName) shippingAddressInput.lastName = lastName;

    if (safeTrim(sa.company)) shippingAddressInput.company = safeTrim(sa.company);
    if (safeTrim(sa.address1)) shippingAddressInput.address1 = safeTrim(sa.address1);
    if (safeTrim(sa.address2)) shippingAddressInput.address2 = safeTrim(sa.address2);
    if (safeTrim(sa.city)) shippingAddressInput.city = safeTrim(sa.city);
    if (safeTrim(sa.province)) shippingAddressInput.province = safeTrim(sa.province);
    if (safeTrim(sa.zip)) shippingAddressInput.zip = safeTrim(sa.zip);
    if (safeTrim(sa.countryCode)) shippingAddressInput.countryCode = safeTrim(sa.countryCode);
    if (safeTrim(sa.phone)) shippingAddressInput.phone = safeTrim(sa.phone);
  }

  const delivery = payload.delivery;
  const shippingPrice = parseDecimalPrice(delivery?.price);

  const input: any = { lineItems: lineItemsInput };

  const email = safeTrim(payload.email);
  if (email) input.email = email;

  if (Object.keys(shippingAddressInput).length) {
    input.shippingAddress = shippingAddressInput;
  }

  if (safeTrim(delivery?.title) && shippingPrice !== null) {
    input.shippingLine = { title: safeTrim(delivery?.title), price: shippingPrice };
  }

  if (customAttributes.length) {
    input.customAttributes = customAttributes;
  }

  const rawDraftOrderId = safeTrim(payload.draftOrderId);
  const draftOrderId = isDraftOrderGid(rawDraftOrderId) ? rawDraftOrderId : "";

  const createMutation = `#graphql
    mutation DraftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id invoiceUrl }
        userErrors { field message }
      }
    }
  `;

  const updateMutation = `#graphql
    mutation DraftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
      draftOrderUpdate(id: $id, input: $input) {
        draftOrder { id invoiceUrl }
        userErrors { field message }
      }
    }
  `;

  let draftRes;
  try {
    draftRes = draftOrderId
      ? await adminGraphql(ctx.admin, updateMutation, { variables: { id: draftOrderId, input } })
      : await adminGraphql(ctx.admin, createMutation, { variables: { input } });
  } catch (e: any) {
    console.error("[prepare] adminGraphql error:", e);
    return json({ error: "Draft order mutation failed" }, { status: 500 });
  }

  const jsonRes = await draftRes.json();
  const node = draftOrderId ? jsonRes?.data?.draftOrderUpdate : jsonRes?.data?.draftOrderCreate;

  const errors = node?.userErrors ?? [];
  if (errors.length) {
    const msg = errors.map((e: any) => e.message).join(", ");
    console.error("[prepare] userErrors:", errors);
    return json({ error: msg, userErrors: errors }, { status: 400 });
  }

  return json({
    pricing,
    draftOrder: node?.draftOrder ?? null,
  });
}
