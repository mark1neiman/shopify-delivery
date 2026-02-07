import { adminGraphql } from "../shipping.server";
import { getCampaigns, type Campaign } from "./campaigns.server";

import { listCampaigns } from "./campaigns-metaobjects.server";

export type PricedLine = {
  variantId: string;
  quantity: number;

  baseUnitPrice: number;
  memberUnitPrice: number;
  finalUnitPrice: number;

  isFree?: boolean;
  freeUnits?: number;

  appliedCampaignIds: string[];
  appliedCampaignLabels: string[];
  appliedPromoCode?: string;
};

export type PricingBreakdown = {
  baseSubtotal: number;
  memberDiscount: number;
  campaignDiscount: number;
  promoDiscount: number;
  finalSubtotal: number;
};

export type AppliedCampaign = {
  id: string;
  type: Campaign["type"];
  label: string;
};

export type PricingResult = {
  lines: PricedLine[];
  breakdown: PricingBreakdown;
  appliedCampaigns: AppliedCampaign[];
  needsFreeChoice: boolean;
  choiceContext?: {
    campaignId: string;
    label: string;
    choices: string[];
  };
  currencyCode: string;
};

export type PricingInput = {
  items: { variantId: string; quantity: number }[];
  customerId: string | null;
  promoCode: string | null;
  freeChoiceVariantId: string | null;
};

const MEMBER_DISCOUNT_RATE = 0.15;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sum(values: number[]) {
  return values.reduce((acc, value) => acc + value, 0);
}

function toGid(rawId: string) {
  const id = String(rawId || "").trim();
  if (!id) return "";
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/ProductVariant/${id}`;
}

type LineState = {
  variantId: string;
  quantity: number;
  baseUnitPrice: number;
  memberUnitPrice: number;

  discountTotal: number; // total discounts applied on this line (campaign + promo)
  freeUnits: number;

  appliedCampaignIds: Set<string>;
  appliedCampaignLabels: Set<string>;
  appliedPromoCode?: string;
};

type PriceMap = Map<string, { amount: number; currencyCode: string }>;

async function fetchVariantPrices(admin: any, variantIds: string[]): Promise<PriceMap> {
  if (!variantIds.length) return new Map();

  const query = `#graphql
    query VariantPrices($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          price {
            amount
            currencyCode
          }
        }
      }
    }
  `;

  const res = await adminGraphql(admin, query, { variables: { ids: variantIds } });
  const json = await res.json();

  const nodes = json.data?.nodes ?? [];
  const map: PriceMap = new Map();

  for (const node of nodes) {
    if (!node?.id) continue;
    const amount = Number.parseFloat(String(node.price?.amount ?? 0));
    map.set(String(node.id), {
      amount: Number.isFinite(amount) ? amount : 0,
      currencyCode: node.price?.currencyCode ?? "USD",
    });
  }

  return map;
}

function ensureLine(lines: Map<string, LineState>, variantId: string, priceMap: PriceMap, quantity: number) {
  const normalized = toGid(variantId);
  const existing = lines.get(normalized);
  if (existing) {
    existing.quantity += quantity;
    return existing;
  }

  const price = priceMap.get(normalized) ?? { amount: 0, currencyCode: "USD" };
  const line: LineState = {
    variantId: normalized,
    quantity,
    baseUnitPrice: price.amount,
    memberUnitPrice: price.amount,
    discountTotal: 0,
    freeUnits: 0,
    appliedCampaignIds: new Set(),
    appliedCampaignLabels: new Set(),
  };
  lines.set(normalized, line);
  return line;
}

function applyMemberDiscount(lines: Map<string, LineState>, hasMember: boolean) {
  if (!hasMember) return;
  for (const line of lines.values()) {
    line.memberUnitPrice = roundMoney(line.baseUnitPrice * (1 - MEMBER_DISCOUNT_RATE));
  }
}

function eligibleUnits(lines: LineState[], eligibleVariantIds: string[]) {
  if (!eligibleVariantIds.length) return [];
  const ids = new Set(eligibleVariantIds.map(toGid));
  return lines.filter((line) => ids.has(line.variantId));
}

function totalLineValue(line: LineState) {
  return line.memberUnitPrice * line.quantity - line.discountTotal;
}

/**
 * cheap-first freebies:
 * - мы собираем пул "единиц" с ценой memberUnitPrice
 * - сортируем по цене
 * - первые N делаем бесплатными (через discountTotal += unitPrice и freeUnits++)
 */
function applyFreeUnits(lines: LineState[], freeCount: number, campaign: Campaign) {
  if (freeCount <= 0) return;

  const unitPool: { line: LineState; unitPrice: number }[] = [];
  for (const line of lines) {
    const paidUnits = Math.max(0, line.quantity - line.freeUnits);
    for (let i = 0; i < paidUnits; i += 1) {
      unitPool.push({ line, unitPrice: line.memberUnitPrice });
    }
  }

  unitPool.sort((a, b) => a.unitPrice - b.unitPrice);
  const freebies = unitPool.slice(0, freeCount);

  for (const freeUnit of freebies) {
    freeUnit.line.discountTotal += freeUnit.unitPrice;
    freeUnit.line.freeUnits += 1;
    freeUnit.line.appliedCampaignIds.add(campaign.id);
    freeUnit.line.appliedCampaignLabels.add(campaign.label);
  }
}

function distributeDiscount(lines: LineState[], discountAmount: number, campaign?: Campaign) {
  if (discountAmount <= 0) return;
  const subtotal = sum(lines.map((line) => totalLineValue(line)));
  if (subtotal <= 0) return;

  let remaining = Math.min(discountAmount, subtotal);

  lines.forEach((line, index) => {
    const weight = totalLineValue(line) / subtotal;
    const raw = roundMoney(discountAmount * weight);
    const discount = index === lines.length - 1 ? remaining : raw;

    line.discountTotal += discount;
    remaining -= discount;

    if (campaign) {
      line.appliedCampaignIds.add(campaign.id);
      line.appliedCampaignLabels.add(campaign.label);
    }
  });
}

async function validatePromoCode(admin: any, code: string) {
  const query = `#graphql
    query PromoCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            title
            customerGets {
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount {
                  amount { amount currencyCode }
                }
              }
            }
            combinesWith {
              orderDiscounts
              productDiscounts
            }
          }
        }
      }
    }
  `;

  try {
    const res = await adminGraphql(admin, query, { variables: { code } });
    const json = await res.json();

    const discount = json.data?.codeDiscountNodeByCode?.codeDiscount;
    if (!discount) return null;

    const value = discount.customerGets?.value;
    const combinesWith = discount.combinesWith ?? { orderDiscounts: true, productDiscounts: true };
    const stackable = Boolean(combinesWith.orderDiscounts || combinesWith.productDiscounts);

    if (value?.__typename === "DiscountPercentage") {
      const rawPercent = Number(value.percentage ?? 0);
      return {
        code,
        type: "percentage" as const,
        value: rawPercent > 1 ? rawPercent : rawPercent * 100,
        stackable,
      };
    }

    if (value?.__typename === "DiscountAmount") {
      const amount = Number(value.amount?.amount ?? 0);
      return {
        code,
        type: "fixed" as const,
        value: Number.isFinite(amount) ? amount : 0,
        stackable,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function buildLines(lines: LineState[]): PricedLine[] {
  return lines.map((line) => {
    const subtotal = line.memberUnitPrice * line.quantity - line.discountTotal;
    const finalUnitPrice = line.quantity ? roundMoney(subtotal / line.quantity) : 0;

    return {
      variantId: line.variantId,
      quantity: line.quantity,
      baseUnitPrice: line.baseUnitPrice,
      memberUnitPrice: line.memberUnitPrice,
      finalUnitPrice,
      isFree: finalUnitPrice <= 0,
      freeUnits: line.freeUnits || undefined,
      appliedCampaignIds: Array.from(line.appliedCampaignIds),
      appliedCampaignLabels: Array.from(line.appliedCampaignLabels),
      appliedPromoCode: line.appliedPromoCode,
    };
  });
}

export async function pricingEngine(admin: any, input: PricingInput): Promise<PricingResult> {
  const normalizedItems = input.items.map((item) => ({
    variantId: toGid(item.variantId),
    quantity: item.quantity,
  }));

  // Чтобы подгрузить цены потенциальных "подарочных" вариантов (free/choice):
  const campaignsFromAdmin = await getCampaigns(admin);

  const campaignVariantIds = campaignsFromAdmin
    .flatMap((campaign) => {
      if (campaign.type === "BuyXGetZFree") return [campaign.freeVariantId];
      if (campaign.type === "BuyXGetZChoice") return campaign.choiceVariantIds;
      if (campaign.type === "CartThresholdFreeChoice") return campaign.choiceVariantIds;
      return [];
    })
    .filter(Boolean);


  const extraVariantIds = [input.freeChoiceVariantId ?? "", ...campaignVariantIds].filter(Boolean);

  const variantIds = Array.from(new Set([...normalizedItems.map((i) => i.variantId), ...extraVariantIds]));
  const priceMap = await fetchVariantPrices(admin, variantIds);
  const currencyCode = priceMap.values().next().value?.currencyCode ?? "USD";

  const linesMap = new Map<string, LineState>();
  for (const item of normalizedItems) {
    ensureLine(linesMap, item.variantId, priceMap, item.quantity);
  }

  // 1) member -15%
  applyMemberDiscount(linesMap, Boolean(input.customerId));

  // 2) campaigns (priority + stackable)
  const appliedCampaigns: { id: string; type: Campaign["type"]; label: string }[] = [];
  let needsFreeChoice = false;
  let choiceContext: PricingResult["choiceContext"];

  const campaigns = [...campaignsFromAdmin].sort((a, b) => a.priority - b.priority);



  let hasNonStackable = false;

  for (const campaign of campaigns) {
    if (hasNonStackable && !campaign.stackable) continue;

    const lines = Array.from(linesMap.values());
    const memberSubtotal = sum(lines.map((l) => l.memberUnitPrice * l.quantity));

    if (campaign.type === "BuyXGetOneFree") {
      const eligible = eligibleUnits(lines, campaign.eligibleVariantIds);
      const totalEligibleQty = sum(eligible.map((l) => l.quantity));
      if (totalEligibleQty < campaign.buyQuantity + 1) continue;

      const freeCount = Math.floor(totalEligibleQty / (campaign.buyQuantity + 1));
      if (freeCount <= 0) continue;

      applyFreeUnits(eligible, freeCount, campaign);
      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (campaign.type === "BuyXGetZFree") {
      if (!campaign.freeVariantId) continue;

      const eligible = eligibleUnits(lines, campaign.triggerVariantIds);
      const totalEligibleQty = sum(eligible.map((l) => l.quantity));
      if (totalEligibleQty < campaign.buyQuantity) continue;

      const freeLine = ensureLine(linesMap, campaign.freeVariantId, priceMap, 1);
      freeLine.discountTotal += freeLine.memberUnitPrice;
      freeLine.freeUnits += 1;
      freeLine.appliedCampaignIds.add(campaign.id);
      freeLine.appliedCampaignLabels.add(campaign.label);

      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (campaign.type === "BuyXGetZChoice") {
      if (!campaign.choiceVariantIds.length) continue;

      const eligible = eligibleUnits(lines, campaign.triggerVariantIds);
      const totalEligibleQty = sum(eligible.map((l) => l.quantity));
      if (totalEligibleQty < campaign.buyQuantity) continue;

      if (!input.freeChoiceVariantId) {
        needsFreeChoice = true;
        choiceContext = { campaignId: campaign.id, label: campaign.label, choices: campaign.choiceVariantIds };
        break;
      }

      const chosen = toGid(input.freeChoiceVariantId);
      if (!campaign.choiceVariantIds.map(toGid).includes(chosen)) continue;

      const freeLine = ensureLine(linesMap, chosen, priceMap, 1);
      freeLine.discountTotal += freeLine.memberUnitPrice;
      freeLine.freeUnits += 1;
      freeLine.appliedCampaignIds.add(campaign.id);
      freeLine.appliedCampaignLabels.add(campaign.label);

      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (campaign.type === "CartThresholdDiscount") {
      if (memberSubtotal < campaign.thresholdAmount) continue;

      let discountAmount = 0;
      if (campaign.discount.type === "percentage") {
        discountAmount = roundMoney(memberSubtotal * (campaign.discount.value / 100));
      } else {
        discountAmount = campaign.discount.value;
      }

      distributeDiscount(lines, discountAmount, campaign);
      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (campaign.type === "CartThresholdFreeChoice") {
      if (memberSubtotal < campaign.thresholdAmount) continue;
      if (!campaign.choiceVariantIds.length) continue;

      if (!input.freeChoiceVariantId) {
        needsFreeChoice = true;
        choiceContext = { campaignId: campaign.id, label: campaign.label, choices: campaign.choiceVariantIds };
        break;
      }

      const chosen = toGid(input.freeChoiceVariantId);
      if (!campaign.choiceVariantIds.map(toGid).includes(chosen)) continue;

      const freeLine = ensureLine(linesMap, chosen, priceMap, 1);
      freeLine.discountTotal += freeLine.memberUnitPrice;
      freeLine.freeUnits += 1;
      freeLine.appliedCampaignIds.add(campaign.id);
      freeLine.appliedCampaignLabels.add(campaign.label);

      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (!campaign.stackable) hasNonStackable = true;
  }

  const lines = Array.from(linesMap.values());

  // breakdown
  const baseSubtotal = roundMoney(sum(lines.map((l) => l.baseUnitPrice * l.quantity)));
  const memberSubtotal = roundMoney(sum(lines.map((l) => l.memberUnitPrice * l.quantity)));
  const memberDiscount = roundMoney(baseSubtotal - memberSubtotal);
  const campaignDiscount = roundMoney(sum(lines.map((l) => l.discountTotal)));

  // 3) promo code (после кампаний)
  let promoDiscount = 0;

  if (!needsFreeChoice && input.promoCode) {
    const promo = await validatePromoCode(admin, input.promoCode);
    if (promo && (promo.stackable || appliedCampaigns.length === 0)) {
      const subtotalAfterCampaigns = memberSubtotal - campaignDiscount;

      if (promo.type === "percentage") {
        promoDiscount = roundMoney(subtotalAfterCampaigns * (promo.value / 100));
      } else {
        promoDiscount = roundMoney(promo.value);
      }

      // promo скидку распределяем пропорционально, но НЕ добавляем campaign labels (это промо)
      distributeDiscount(lines, promoDiscount);
      for (const line of lines) {
        line.appliedPromoCode = promo.code;
      }
    }
  }

  const finalSubtotal = roundMoney(memberSubtotal - campaignDiscount - promoDiscount);
  const pricedLines = buildLines(lines);

  return {
    lines: pricedLines,
    breakdown: { baseSubtotal, memberDiscount, campaignDiscount, promoDiscount, finalSubtotal },
    appliedCampaigns,
    needsFreeChoice,
    choiceContext,
    currencyCode,
  };
}
