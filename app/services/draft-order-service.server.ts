import { adminGraphql } from "../shipping.server";
import type { PricedLine, PricingBreakdown, AppliedCampaign } from "./pricing-engine.server";
import type { ShippingLine, ShippingSelection } from "./shipping-service.server";

type CreateDraftOrderInput = {
  lines: PricedLine[];
  currencyCode: string;
  shippingLine: ShippingLine | null;
  shippingSelection: ShippingSelection | null;
  breakdown: PricingBreakdown;
  appliedCampaigns: AppliedCampaign[];
  promoCode: string | null;
};

function toMoney(amount: number, currencyCode: string) {
  return {
    amount: String(Math.max(0, Number.isFinite(amount) ? amount : 0)),
    currencyCode,
  };
}

export async function createDraftOrder(admin: any, input: CreateDraftOrderInput) {
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
    }
  `;

  const metafields = [
    {
      namespace: "itella",
      key: "pricing_breakdown",
      type: "json",
      value: JSON.stringify(input.breakdown),
    },
    {
      namespace: "itella",
      key: "pricing_applied_campaigns",
      type: "json",
      value: JSON.stringify(input.appliedCampaigns),
    },
    {
      namespace: "itella",
      key: "shipping_selection",
      type: "json",
      value: JSON.stringify(input.shippingSelection),
    },
    {
      namespace: "itella",
      key: "promo_code",
      type: "single_line_text_field",
      value: input.promoCode || "",
    },
  ];

  // IMPORTANT:
  // Для variant line items Shopify поддерживает DraftOrderLineItemInput.priceOverride (MoneyInput),
  // чтобы задать цену вместо каталожной. :contentReference[oaicite:2]{index=2}
  const lineItems = input.lines.map((l) => ({
    variantId: l.variantId,
    quantity: l.quantity,
    priceOverride: toMoney(l.finalUnitPrice, input.currencyCode),
  }));

  // Shipping: в DraftOrderInput есть shippingLine (title + price).
  const draftInput: any = {
    lineItems,
    metafields,
  };

  if (input.shippingLine) {
    draftInput.shippingLine = {
      title: input.shippingLine.title,
      price: toMoney(input.shippingLine.price, input.currencyCode),
    };
  }

  const res = await adminGraphql(admin, mutation, { variables: { input: draftInput } });
  const json = await res.json();

  const errors = json.data?.draftOrderCreate?.userErrors ?? [];
  if (errors.length) {
    const msg = errors.map((e: any) => `${e.field?.join(".") || "?"}: ${e.message}`).join(" | ");
    throw new Error(`draftOrderCreate failed: ${msg}`);
  }

  const draft = json.data?.draftOrderCreate?.draftOrder;
  if (!draft?.id) throw new Error("draftOrderCreate failed: missing draftOrder.id");

  return {
    draftOrderId: String(draft.id),
    invoiceUrl: String(draft.invoiceUrl || ""),
  };
}
