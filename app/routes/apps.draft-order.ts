import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { adminGraphql } from "../shipping.server";

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

type DraftOrderPayload = {
  draftOrderId?: string;

  // optional: if you want the draft to match preview totals,
  // pass pricing from /apps/checkout/prepare response
  pricing?: {
    lines?: { variantId: string; quantity: number }[];
    breakdown?: {
      baseSubtotal?: number;
      finalSubtotal?: number;
      memberDiscount?: number;
      campaignDiscount?: number;
      promoDiscount?: number;
    };
    currencyCode?: string;
  };

  promoCode?: string | null;

  email?: string;

  // fallback if pricing not provided
  lineItems?: { variantId: string | number; quantity: number }[];

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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampMoney(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, roundMoney(n));
}

/**
 * Prefer pricing.lines (so freebies are included).
 * Fallback to payload.lineItems.
 */
function buildLineItemsFromPayload(payload: DraftOrderPayload) {
  const fromPricing = (payload.pricing?.lines ?? [])
    .map((l) => ({
      variantId: safeTrim(l.variantId),
      quantity: Number(l.quantity || 0),
    }))
    .filter((x) => x.variantId && Number.isFinite(x.quantity) && x.quantity > 0);

  if (fromPricing.length) {
    return fromPricing.map((x) => ({
      variantId: toGid(x.variantId),
      quantity: x.quantity,
    }));
  }

  const fromLineItems = (payload.lineItems ?? [])
    .filter((item) => item.variantId && item.quantity)
    .map((item) => ({
      variantId: toGid(item.variantId),
      quantity: Number(item.quantity),
    }))
    .filter((x) => Number.isFinite(x.quantity) && x.quantity > 0);

  return fromLineItems;
}

/**
 * Apply order-level appliedDiscount so draft total matches preview.
 * We use: baseSubtotal - finalSubtotal.
 */
function computeAppliedDiscount(payload: DraftOrderPayload) {
  const b = payload.pricing?.breakdown;
  if (!b) return null;

  const baseSubtotal = Number(b.baseSubtotal ?? NaN);
  const finalSubtotal = Number(b.finalSubtotal ?? NaN);

  if (!Number.isFinite(baseSubtotal) || !Number.isFinite(finalSubtotal)) return null;

  const diff = clampMoney(baseSubtotal - finalSubtotal);
  if (diff <= 0) return null;

  const currencyCode = safeTrim(payload.pricing?.currencyCode) || safeTrim(payload.delivery?.currency) || "EUR";

  return {
    title: "Discount",
    description: "Auto pricing engine",
    valueType: "FIXED_AMOUNT" as const,
    value: diff,
    amount: diff,
    currencyCode,
  };
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

  let payload: DraftOrderPayload;
  try {
    payload = (await request.json()) as DraftOrderPayload;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ---- server log (masked) ----
  try {
    console.log("[draft-order] incoming payload (masked)", {
      draftOrderId: safeTrim(payload.draftOrderId),
      email: maskEmail(safeTrim(payload.email)),
      hasPricing: !!payload.pricing,
      pricingLinesCount: payload.pricing?.lines?.length || 0,
      lineItemsCount: payload.lineItems?.length || 0,
      shippingAddress: {
        name: safeTrim(payload.shippingAddress?.name),
        address1: safeTrim(payload.shippingAddress?.address1),
        city: safeTrim(payload.shippingAddress?.city),
        zip: safeTrim(payload.shippingAddress?.zip),
        countryCode: safeTrim(payload.shippingAddress?.countryCode),
        phone: maskPhone(safeTrim(payload.shippingAddress?.phone)),
      },
      delivery: payload.delivery,
      promoCode: payload.promoCode ? "***" : null,
      attributesKeys: Object.keys(payload.attributes || {}),
    });
  } catch {
    // ignore logging errors
  }

  const lineItemsInput = buildLineItemsFromPayload(payload);

  if (lineItemsInput.length === 0) {
    return json({ error: "No line items" }, { status: 400 });
  }

  // customAttributes (order attributes in Shopify draft)
  const customAttributes: { key: string; value: string }[] = [];
  const attrs = payload.attributes || {};

  // optionally keep promoCode visible in draft attributes
  const promo = safeTrim(payload.promoCode);
  if (promo) attrs["promo_code"] = promo;

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    const v = String(value).trim();
    if (!v) continue;
    customAttributes.push({ key, value: v });
  }

  // shippingAddress
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

  // Shopify draft email
  const email = safeTrim(payload.email);
  if (email) input.email = email;

  if (Object.keys(shippingAddressInput).length) {
    input.shippingAddress = shippingAddressInput;
  }

  // shipping line
  if (safeTrim(delivery?.title) && shippingPrice !== null) {
    input.shippingLine = { title: safeTrim(delivery?.title), price: shippingPrice };
  }

  if (customAttributes.length) {
    input.customAttributes = customAttributes;
  }

  // appliedDiscount to match pricing preview totals
  const appliedDiscount = computeAppliedDiscount(payload);
  if (appliedDiscount) {
    input.appliedDiscount = {
      title: appliedDiscount.title,
      description: appliedDiscount.description,
      valueType: appliedDiscount.valueType,
      value: appliedDiscount.value,
      amount: appliedDiscount.amount,
    };
  }

  // --- update if draftOrderId exists
  const rawDraftOrderId = safeTrim(payload.draftOrderId);
  const draftOrderId = isDraftOrderGid(rawDraftOrderId) ? rawDraftOrderId : "";

  // ---- server log: what we send to Shopify (masked) ----
  try {
    console.log("[draft-order] shopify input (masked)", {
      hasId: !!draftOrderId,
      email: maskEmail(safeTrim(input.email)),
      lineItemsCount: input.lineItems?.length || 0,
      shippingAddress: input.shippingAddress
        ? {
            ...input.shippingAddress,
            phone: maskPhone(safeTrim(input.shippingAddress.phone)),
          }
        : null,
      shippingLine: input.shippingLine || null,
      appliedDiscount: input.appliedDiscount ? { ...input.appliedDiscount, description: "***" } : null,
      customAttributesCount: input.customAttributes?.length || 0,
    });
  } catch {}

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

  const res = draftOrderId
    ? await adminGraphql(ctx.admin, updateMutation, {
        variables: { id: draftOrderId, input },
      })
    : await adminGraphql(ctx.admin, createMutation, { variables: { input } });

  const jsonRes = await res.json();

  const node = draftOrderId ? jsonRes?.data?.draftOrderUpdate : jsonRes?.data?.draftOrderCreate;

  const errors = node?.userErrors ?? [];
  if (errors.length) {
    const msg = errors.map((e: any) => e.message).join(", ");
    console.error("[draft-order] userErrors:", errors);
    return json(
      {
        error: msg,
        userErrors: errors,
      },
      { status: 400 },
    );
  }

  return json({ draftOrder: node?.draftOrder ?? null });
}
