import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
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
  lineItems?: { variantId: string | number; quantity: number }[];
  shippingAddress?: {
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    zip?: string;
    countryCode?: string;
    phone?: string;
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

function parsePriceInput(price?: string, currency?: string) {
  if (!price) return null;
  const amountMatch = price.match(/[\d.,]+/);
  const amount = amountMatch ? amountMatch[0].replace(",", ".") : null;
  const currencyMatch = currency ?? price.match(/[A-Z]{3}/)?.[0] ?? null;
  if (!amount) return null;
  return {
    amount,
    currencyCode: currencyMatch ?? undefined,
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
          "App proxy session is unavailable. Open the app in Admin to refresh the session.",
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
    }));

  if (lineItemsInput.length === 0) {
    return json({ error: "No line items" }, { status: 400 });
  }

  const shippingAddress = payload.shippingAddress;
  const delivery = payload.delivery;
  const shippingLinePrice = parsePriceInput(
    delivery?.price,
    delivery?.currency,
  );

  const noteAttributes: { name: string; value: string }[] = [];
  if (payload.attributes) {
    for (const [key, value] of Object.entries(payload.attributes)) {
      if (value === null || value === undefined || value === "") continue;
      noteAttributes.push({ name: key, value: String(value) });
    }
  }

  const mutation = `#graphql
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        invoiceUrl
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const input: any = {
    lineItems: lineItemsInput,
  };

  if (shippingAddress && Object.values(shippingAddress).some(Boolean)) {
    input.shippingAddress = shippingAddress;
  }

  if (delivery?.title && shippingLinePrice?.amount) {
    input.shippingLine = {
      title: delivery.title,
      price: {
        amount: shippingLinePrice.amount,
        ...(shippingLinePrice.currencyCode
          ? { currencyCode: shippingLinePrice.currencyCode }
          : {}),
      },
    };
  }

  if (noteAttributes.length) {
    input.noteAttributes = noteAttributes;
  }

  const res = await adminGraphql(ctx.admin, mutation, { variables: { input } });
  const jsonRes = await res.json();
  const errors = jsonRes.data?.draftOrderCreate?.userErrors ?? [];
  if (errors.length) {
    return json({ error: errors.map((e: any) => e.message).join(", ") }, { status: 400 });
  }

  return json({
    draftOrder: jsonRes.data?.draftOrderCreate?.draftOrder ?? null,
  });
}
