// app/services/pricing-engine.server.ts
import { adminGraphql } from "../shipping.server";

type Input = {
  mode: "preview" | "draft" | string;
  customerId: string | null;
  items: { variantId: string; quantity: number }[];
  shipping?: any;
  promoCode?: string | null;
  freeChoiceVariantId?: string | null;

  // optional fields (not required for preview)
  email?: string;
  shippingAddress?: any;
  attributes?: Record<string, any> | null;
  delivery?: any;
  draftOrderId?: string | null;
};

type PricingLine = {
  variantId: string;
  quantity: number;

  baseUnitPrice: number;
  memberUnitPrice: number;

  isFree: boolean;
  freeUnits: number;

  appliedCampaignLabels: string[];
  appliedPromoCode: string | null;
};

type Pricing = {
  currencyCode: string;
  breakdown: {
    baseSubtotal: number;
    memberDiscount: number;
    campaignDiscount: number;
    promoDiscount: number;
    finalSubtotal: number;
  };
  lines: PricingLine[];
};

type PriceMap = Map<string, { amount: number; currencyCode: string }>;

function safeNumber(n: any) {
  const v = Number.parseFloat(String(n ?? 0).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function fetchVariantPrices(admin: any, variantIds: string[]): Promise<PriceMap> {
  const map: PriceMap = new Map();
  if (!variantIds.length) return map;

  const query = `#graphql
    query VariantPrices($ids: [ID!]!) {
      shop { currencyCode }
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          price
        }
      }
    }
  `;

  try {
    const res = await adminGraphql(admin, query, { variables: { ids: variantIds } });
    const json = await res.json();

    const currencyCode = json?.data?.shop?.currencyCode ?? "EUR";
    const nodes = json?.data?.nodes ?? [];

    for (const n of nodes) {
      if (!n?.id) continue;
      // Admin API: price = Money scalar (string "12.34")
      map.set(String(n.id), { amount: safeNumber(n.price), currencyCode });
    }

    return map;
  } catch (err: any) {
    // Shopify SDK кидает GraphqlQueryError -> иначе prepare падал 500
    console.error("[pricing] fetchVariantPrices failed:", err?.message ?? err);
    return map;
  }
}

export async function pricingEngine(admin: any, input: Input): Promise<Pricing> {
  const items = Array.isArray(input.items) ? input.items : [];
  const variantIds = items.map((x) => String(x.variantId || "")).filter(Boolean);

  const prices = await fetchVariantPrices(admin, variantIds);

  // currency: берем из первого найденного, иначе EUR
  let currencyCode = "EUR";
  for (const v of prices.values()) {
    if (v?.currencyCode) {
      currencyCode = v.currencyCode;
      break;
    }
  }

  const isMember = !!input.customerId; // включай как тебе надо

  const lines: PricingLine[] = [];
  let baseSubtotal = 0;
  let memberSubtotal = 0;

  for (const it of items) {
    const variantId = String(it.variantId || "");
    const quantity = Number(it.quantity || 0);
    if (!variantId || !Number.isFinite(quantity) || quantity <= 0) continue;

    const p = prices.get(variantId);
    const baseUnitPrice = round2(p?.amount ?? 0);

    // Member -15% (пример), только если customerId есть
    const memberUnitPrice = isMember ? round2(baseUnitPrice * 0.85) : baseUnitPrice;

    const lineBase = round2(baseUnitPrice * quantity);
    const lineMember = round2(memberUnitPrice * quantity);

    baseSubtotal += lineBase;
    memberSubtotal += lineMember;

    lines.push({
      variantId,
      quantity,
      baseUnitPrice,
      memberUnitPrice,
      isFree: false,
      freeUnits: 0,
      appliedCampaignLabels: [],
      appliedPromoCode: input.promoCode ? String(input.promoCode) : null,
    });
  }

  baseSubtotal = round2(baseSubtotal);
  memberSubtotal = round2(memberSubtotal);

  const memberDiscount = round2(baseSubtotal - memberSubtotal);
  const campaignDiscount = 0;
  const promoDiscount = 0;

  const finalSubtotal = round2(baseSubtotal - memberDiscount - campaignDiscount - promoDiscount);

  return {
    currencyCode,
    breakdown: {
      baseSubtotal,
      memberDiscount,
      campaignDiscount,
      promoDiscount,
      finalSubtotal,
    },
    lines,
  };
}
