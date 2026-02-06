import { adminGraphql } from "../shipping.server";
import type { PricedLine, PricingBreakdown, AppliedCampaign } from "./pricing-engine.server";
import type { ShippingLine, ShippingSelection } from "./shipping-service.server";

export type DraftOrderResult = {
  draftOrderId: string | null;
  invoiceUrl: string | null;
};

export type DraftOrderInput = {
  lines: PricedLine[];
  currencyCode: string;
  shippingLine: ShippingLine | null;
  shippingSelection: ShippingSelection | null;
  breakdown: PricingBreakdown;
  appliedCampaigns: AppliedCampaign[];
  promoCode: string | null;
};

export async function createDraftOrder(admin: any, input: DraftOrderInput): Promise<DraftOrderResult> {
  const mutation = `#graphql
    mutation DraftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id invoiceUrl }
        userErrors { field message }
      }
    }
  `;

  const lineItems = input.lines.map((line) => ({
    variantId: line.variantId,
    quantity: line.quantity,
    originalUnitPrice: {
      amount: String(line.finalUnitPrice),
      currencyCode: input.currencyCode,
    },
  }));

  const metafields = [
    {
      namespace: "pricing",
      key: "breakdown",
      type: "json",
      value: JSON.stringify(input.breakdown),
    },
    {
      namespace: "pricing",
      key: "appliedCampaigns",
      type: "json",
      value: JSON.stringify(input.appliedCampaigns),
    },
    {
      namespace: "shipping",
      key: "selection",
      type: "json",
      value: JSON.stringify(input.shippingSelection ?? {}),
    },
  ];

  if (input.promoCode) {
    metafields.push({
      namespace: "promo",
      key: "code",
      type: "single_line_text_field",
      value: input.promoCode,
    });
  }

  const variables: any = {
    input: {
      lineItems,
      metafields,
    },
  };

  if (input.shippingLine) {
    variables.input.shippingLine = {
      title: input.shippingLine.title,
      price: input.shippingLine.price,
    };
  }

  const res = await adminGraphql(admin, mutation, { variables });
  const json = await res.json();
  const node = json.data?.draftOrderCreate;
  const errors = node?.userErrors ?? [];
  if (errors.length) {
    const msg = errors.map((err: any) => err.message).join(", ");
    throw new Error(msg);
  }

  return {
    draftOrderId: node?.draftOrder?.id ?? null,
    invoiceUrl: node?.draftOrder?.invoiceUrl ?? null,
  };
}
