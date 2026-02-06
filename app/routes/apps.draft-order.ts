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
  draftOrderId?: string; // <-- NEW
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

  let payload: DraftOrderPayload;
  try {
    payload = (await request.json()) as DraftOrderPayload;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const lineItemsInput = (payload.lineItems ?? [])
    .filter((item) => item.variantId && item.quantity)
    .map((item) => ({
      variantId: toGid(item.variantId),
      quantity: Number(item.quantity),
    }))
    .filter((x) => x.quantity > 0);

  if (lineItemsInput.length === 0) {
    return json({ error: "No line items" }, { status: 400 });
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
    const firstName = (sa.firstName ?? fromName.firstName ?? "").trim();
    const lastName = (sa.lastName ?? fromName.lastName ?? "").trim();

    if (firstName) shippingAddressInput.firstName = firstName;
    if (lastName) shippingAddressInput.lastName = lastName;

    if (sa.company) shippingAddressInput.company = sa.company;
    if (sa.address1) shippingAddressInput.address1 = sa.address1;
    if (sa.address2) shippingAddressInput.address2 = sa.address2;
    if (sa.city) shippingAddressInput.city = sa.city;
    if (sa.province) shippingAddressInput.province = sa.province;
    if (sa.zip) shippingAddressInput.zip = sa.zip;
    if (sa.countryCode) shippingAddressInput.countryCode = sa.countryCode;
    if (sa.phone) shippingAddressInput.phone = sa.phone;
  }

  const delivery = payload.delivery;
  const shippingPrice = parseDecimalPrice(delivery?.price);

  const input: any = { lineItems: lineItemsInput };

  if (Object.keys(shippingAddressInput).length) {
    input.shippingAddress = shippingAddressInput;
  }

  if (delivery?.title && shippingPrice !== null) {
    input.shippingLine = { title: delivery.title, price: shippingPrice };
  }

  if (customAttributes.length) {
    input.customAttributes = customAttributes;
  }

  // --- NEW: update if draftOrderId exists
  const draftOrderId = (payload.draftOrderId || "").trim();

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

  const node = draftOrderId
    ? jsonRes?.data?.draftOrderUpdate
    : jsonRes?.data?.draftOrderCreate;

  const errors = node?.userErrors ?? [];
  if (errors.length) {
    return json(
      {
        error: errors.map((e: any) => e.message).join(", "),
        userErrors: errors,
      },
      { status: 400 },
    );
  }

  return json({ draftOrder: node?.draftOrder ?? null });
}
