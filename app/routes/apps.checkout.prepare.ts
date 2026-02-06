import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  pricingEngine,
  type PricingInput,
} from "../services/pricing-engine.server";
import {
  calculateShippingLine,
  type ShippingSelection,
} from "../services/shipping-service.server";
import { createDraftOrder } from "../services/draft-order-service.server";

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
  mode: "preview" | "checkout";
  customerId: string | null;
  items: { variantId: string; quantity: number }[];
  shipping: ShippingSelection | null;
  promoCode: string | null;
  freeChoiceVariantId: string | null;
};

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

  if (!payload.items?.length) {
    return json({ error: "No line items" }, { status: 400 });
  }

  const pricingInput: PricingInput = {
    items: payload.items,
    customerId: payload.customerId ?? null,
    promoCode: payload.promoCode ?? null,
    freeChoiceVariantId: payload.freeChoiceVariantId ?? null,
  };

  const pricing = await pricingEngine(ctx.admin, pricingInput);

  if (pricing.needsFreeChoice) {
    return json(
      {
        pricing,
        needsFreeChoice: true,
      },
      { status: 200 },
    );
  }

  if (payload.mode === "preview") {
    return json({ pricing, needsFreeChoice: false });
  }

  const shippingLine = calculateShippingLine(payload.shipping);

  const draftOrder = await createDraftOrder(ctx.admin, {
    lines: pricing.lines,
    currencyCode: pricing.currencyCode,
    shippingLine,
    shippingSelection: payload.shipping,
    breakdown: pricing.breakdown,
    appliedCampaigns: pricing.appliedCampaigns,
    promoCode: payload.promoCode,
  });

  return json({
    pricing,
    needsFreeChoice: false,
    draftOrderId: draftOrder.draftOrderId,
    invoiceUrl: draftOrder.invoiceUrl,
  });
}

export async function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
