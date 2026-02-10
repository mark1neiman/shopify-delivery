//shopify-delivery/app/services/pricing-engine.server.ts

import { adminGraphql } from "../shipping.server";
import { getCampaigns, type Campaign } from "./campaigns.server";

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

  // ✅ explicit gift line (so storefront can auto-add/remove gifts)
  isGiftLine?: boolean;
  giftCampaignId?: string;

  // ✅ NEW: per-campaign allocated qty for this line
  campaignQuantities?: Record<string, number>;
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
  // ✅ unique key, so gift lines do not merge with regular lines
  key: string;

  variantId: string;
  quantity: number;
  baseUnitPrice: number;
  memberUnitPrice: number;

  discountTotal: number;
  freeUnits: number;

  appliedCampaignIds: Set<string>;
  appliedCampaignLabels: Set<string>;
  appliedPromoCode?: string;

  // ✅ gift marker
  isGiftLine?: boolean;
  giftCampaignId?: string;

  // ✅ NEW: allocation map (campaignId -> qty allocated to that campaign)
  campaignQuantities: Record<string, number>;
};

type PriceMap = Map<string, { amount: number; currencyCode: string }>;

function safeNumber(n: any) {
  const v = Number.parseFloat(String(n ?? 0).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function parseMoneyScalar(price: any) {
  const amount = safeNumber(price);
  return Number.isFinite(amount) ? amount : 0;
}

type RunResult = { ok: true; json: any } | { ok: false; error: any };

async function fetchVariantPrices(admin: any, variantIds: string[]): Promise<PriceMap> {
  const map: PriceMap = new Map();
  if (!variantIds.length) return map;

  const ids = variantIds;

  const qPriceV2 = `#graphql
    query VariantPricesV2($ids: [ID!]!) {
      shop { currencyCode }
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          priceV2 { amount currencyCode }
        }
      }
    }
  `;

  const qPriceMoneyV2 = `#graphql
    query VariantPricesMoneyV2($ids: [ID!]!) {
      shop { currencyCode }
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          price { amount currencyCode }
        }
      }
    }
  `;

  const qPriceScalar = `#graphql
    query VariantPricesScalar($ids: [ID!]!) {
      shop { currencyCode }
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          price
        }
      }
    }
  `;

  async function run(query: string): Promise<RunResult> {
    try {
      const res = await adminGraphql(admin, query, { variables: { ids } });
      const json = await res.json();
      return { ok: true, json };
    } catch (error: any) {
      return { ok: false, error };
    }
  }

  function hasGraphQLErrors(json: any) {
    return Array.isArray(json?.errors) && json.errors.length > 0;
  }

  function storeCurrency(json: any) {
    return String(json?.data?.shop?.currencyCode || "USD");
  }

  function buildMapFromNodes(
    nodes: any[],
    currencyFallback: string,
    pick: (node: any, currencyFallback: string) => { amount: number; currencyCode: string } | null,
  ) {
    const out: PriceMap = new Map();
    for (const node of nodes || []) {
      if (!node?.id) continue;
      const got = pick(node, currencyFallback);
      if (!got) continue;
      out.set(String(node.id), got);
    }
    return out;
  }

  // 1) Try priceV2
  {
    const r = await run(qPriceV2);
    if (r.ok && !hasGraphQLErrors(r.json)) {
      const nodes = r.json.data?.nodes ?? [];
      const cur = storeCurrency(r.json);
      const out = buildMapFromNodes(nodes, cur, (n) => {
        if (n?.priceV2?.amount == null) return null;
        const amt = safeNumber(n.priceV2.amount);
        return { amount: amt, currencyCode: String(n.priceV2.currencyCode || cur) };
      });
      if (out.size) return out;
    }
  }

  // 2) Try price as MoneyV2 object
  {
    const r = await run(qPriceMoneyV2);
    if (r.ok && !hasGraphQLErrors(r.json)) {
      const nodes = r.json.data?.nodes ?? [];
      const cur = storeCurrency(r.json);
      const out = buildMapFromNodes(nodes, cur, (n) => {
        if (n?.price?.amount == null) return null;
        const amt = safeNumber(n.price.amount);
        return { amount: amt, currencyCode: String(n.price.currencyCode || cur) };
      });
      if (out.size) return out;
    }
  }

  // 3) Try price as scalar
  {
    const r = await run(qPriceScalar);
    if (r.ok && !hasGraphQLErrors(r.json)) {
      const nodes = r.json.data?.nodes ?? [];
      const cur = storeCurrency(r.json);
      const out = buildMapFromNodes(nodes, cur, (n, currencyFallback) => {
        if (n?.price == null) return null;
        const amt = parseMoneyScalar(n.price);
        return { amount: amt, currencyCode: currencyFallback };
      });
      if (out.size) return out;
    }
  }

  return map;
}

// ✅ Regular line: key == variantId (GID)
function ensureRegularLine(lines: Map<string, LineState>, variantId: string, priceMap: PriceMap, quantity: number) {
  const normalized = toGid(variantId);
  const key = normalized;

  const existing = lines.get(key);
  if (existing) {
    existing.quantity += quantity;
    return existing;
  }

  const price = priceMap.get(normalized) ?? { amount: 0, currencyCode: "USD" };

  const line: LineState = {
    key,
    variantId: normalized,
    quantity,
    baseUnitPrice: price.amount,
    memberUnitPrice: price.amount,
    discountTotal: 0,
    freeUnits: 0,
    appliedCampaignIds: new Set(),
    appliedCampaignLabels: new Set(),
    campaignQuantities: {}, // ✅ NEW
  };

  lines.set(key, line);
  return line;
}

// ✅ Gift line: unique key (gift:campaignId:variantId) so it never merges with regular items
function createGiftLine(
  lines: Map<string, LineState>,
  campaign: Campaign,
  variantId: string,
  priceMap: PriceMap,
  quantity: number,
) {
  const normalized = toGid(variantId);
  const key = `gift:${campaign.id}:${normalized}`;

  const price = priceMap.get(normalized) ?? { amount: 0, currencyCode: "USD" };

  const line: LineState = {
    key,
    variantId: normalized,
    quantity,
    baseUnitPrice: price.amount,
    memberUnitPrice: price.amount,
    discountTotal: 0,
    freeUnits: 0,
    appliedCampaignIds: new Set([campaign.id]),
    appliedCampaignLabels: new Set([campaign.label]),
    isGiftLine: true,
    giftCampaignId: campaign.id,
    campaignQuantities: {}, // ✅ NEW (not used for gifts, but keeps shape consistent)
  };

  // Make gift free:
  line.discountTotal += line.memberUnitPrice * quantity;
  line.freeUnits += quantity;

  lines.set(key, line);
  return line;
}

function applyMemberDiscount(lines: Map<string, LineState>, hasMember: boolean) {
  if (!hasMember) return;
  for (const line of lines.values()) {
    // ✅ do not apply member discount to gift line (cosmetic; gift is already free)
    if (line.isGiftLine) continue;
    line.memberUnitPrice = roundMoney(line.baseUnitPrice * (1 - MEMBER_DISCOUNT_RATE));
  }
}

function eligibleUnits(lines: LineState[], eligibleVariantIds: string[]) {
  if (!eligibleVariantIds.length) return [];
  const ids = new Set(eligibleVariantIds.map(toGid));
  // ✅ gifts should never count as eligible units/triggers
  return lines.filter((line) => !line.isGiftLine && ids.has(line.variantId));
}

function totalLineValue(line: LineState) {
  return line.memberUnitPrice * line.quantity - line.discountTotal;
}

/**
 * ✅ NEW: allocate N units of eligible trigger lines to a campaign (UI uses this)
 * - Doesn't change price.
 * - Adds appliedCampaignIds/Labels.
 */
function allocateCampaignUnits(lines: LineState[], campaign: Campaign, unitsNeeded: number) {
  let remaining = Math.max(0, Number(unitsNeeded || 0));
  if (remaining <= 0) return;

  for (const line of lines) {
    if (remaining <= 0) break;

    const already = Number(line.campaignQuantities[campaign.id] || 0);
    const available = Math.max(0, Number(line.quantity || 0) - already);
    if (available <= 0) continue;

    const take = Math.min(available, remaining);

    line.campaignQuantities[campaign.id] = already + take;
    line.appliedCampaignIds.add(campaign.id);
    line.appliedCampaignLabels.add(campaign.label);

    remaining -= take;
  }
}

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

    // ✅ NEW: mark that 1 unit was allocated to this campaign (for UI)
    freeUnit.line.campaignQuantities[campaign.id] = Number(freeUnit.line.campaignQuantities[campaign.id] || 0) + 1;
  }
}

function distributeDiscount(lines: LineState[], discountAmount: number, campaign?: Campaign) {
  if (discountAmount <= 0) return;

  // ✅ only discount payable lines (exclude gifts)
  const payable = lines.filter((l) => !l.isGiftLine);

  const subtotal = sum(payable.map((line) => totalLineValue(line)));
  if (subtotal <= 0) return;

  let remaining = Math.min(discountAmount, subtotal);

  payable.forEach((line, index) => {
    const weight = totalLineValue(line) / subtotal;
    const raw = roundMoney(discountAmount * weight);
    const discount = index === payable.length - 1 ? remaining : raw;

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

    const cq = line.campaignQuantities || {};
    const cqKeys = Object.keys(cq);
    const cqOut = cqKeys.length ? cq : undefined;

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

      isGiftLine: Boolean(line.isGiftLine),
      giftCampaignId: line.giftCampaignId,

      // ✅ NEW
      campaignQuantities: cqOut,
    };
  });
}

export async function pricingEngine(admin: any, input: PricingInput): Promise<PricingResult> {
  const normalizedItems = input.items.map((item) => ({
    variantId: toGid(item.variantId),
    quantity: item.quantity,
  }));

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

  const first = priceMap.values().next().value as { amount: number; currencyCode: string } | undefined;
  const currencyCode = first?.currencyCode ?? "USD";

  const linesMap = new Map<string, LineState>();

  // ✅ build regular lines first
  for (const item of normalizedItems) {
    ensureRegularLine(linesMap, item.variantId, priceMap, item.quantity);
  }

  applyMemberDiscount(linesMap, Boolean(input.customerId));

  const appliedCampaigns: { id: string; type: Campaign["type"]; label: string }[] = [];
  let needsFreeChoice = false;
  let choiceContext: PricingResult["choiceContext"];

  const campaigns = [...campaignsFromAdmin].sort((a, b) => a.priority - b.priority);

  let hasNonStackable = false;

  for (const campaign of campaigns) {
    if (hasNonStackable && !campaign.stackable) continue;

    const allLines = Array.from(linesMap.values());
    const regularLines = allLines.filter((l) => !l.isGiftLine);

    // ✅ thresholds use ONLY regular lines (exclude gifts)
    const memberSubtotal = sum(regularLines.map((l) => l.memberUnitPrice * l.quantity));

    if (campaign.type === "BuyXGetOneFree") {
      const eligible = eligibleUnits(regularLines, campaign.eligibleVariantIds);
      const totalEligibleQty = sum(eligible.map((l) => l.quantity));
      if (totalEligibleQty < campaign.buyQuantity + 1) continue;

      const freeCount = Math.floor(totalEligibleQty / (campaign.buyQuantity + 1));
      if (freeCount <= 0) continue;

      applyFreeUnits(eligible, freeCount, campaign);
      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (campaign.type === "BuyXGetZFree") {
      if (!campaign.freeVariantId) continue;

      const eligible = eligibleUnits(regularLines, campaign.triggerVariantIds);
      const totalEligibleQty = sum(eligible.map((l) => l.quantity));
      if (totalEligibleQty < campaign.buyQuantity) continue;

      // ✅ NEW: allocate EXACT buyQuantity to the campaign (UI needs it)
      allocateCampaignUnits(eligible, campaign, campaign.buyQuantity);

      createGiftLine(linesMap, campaign, campaign.freeVariantId, priceMap, 1);
      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (campaign.type === "BuyXGetZChoice") {
      if (!campaign.choiceVariantIds.length) continue;

      const eligible = eligibleUnits(regularLines, campaign.triggerVariantIds);
      const totalEligibleQty = sum(eligible.map((l) => l.quantity));
      if (totalEligibleQty < campaign.buyQuantity) continue;

      if (!input.freeChoiceVariantId) {
        needsFreeChoice = true;
        choiceContext = { campaignId: campaign.id, label: campaign.label, choices: campaign.choiceVariantIds };
        break;
      }

      const chosen = toGid(input.freeChoiceVariantId);
      if (!campaign.choiceVariantIds.map(toGid).includes(chosen)) continue;

      // ✅ NEW: allocate EXACT buyQuantity to the campaign (UI needs it)
      allocateCampaignUnits(eligible, campaign, campaign.buyQuantity);

      createGiftLine(linesMap, campaign, chosen, priceMap, 1);
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

      // ✅ discount applies only to regular lines
      distributeDiscount(regularLines, discountAmount, campaign);

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

      // (threshold choice doesn't have buyQuantity triggers to allocate deterministically)
      createGiftLine(linesMap, campaign, chosen, priceMap, 1);

      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (!campaign.stackable) hasNonStackable = true;
  }

  const allLines = Array.from(linesMap.values());
  const regularLines = allLines.filter((l) => !l.isGiftLine);

  // ✅ breakdown is for payable items only
  const baseSubtotal = roundMoney(sum(regularLines.map((l) => l.baseUnitPrice * l.quantity)));
  const memberSubtotal = roundMoney(sum(regularLines.map((l) => l.memberUnitPrice * l.quantity)));
  const memberDiscount = roundMoney(baseSubtotal - memberSubtotal);

  // ✅ campaignDiscount counts only discounts on regular lines (gifts excluded)
  const campaignDiscount = roundMoney(sum(regularLines.map((l) => l.discountTotal)));

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

      // ✅ promo applies only to regular lines
      distributeDiscount(regularLines, promoDiscount);

      for (const line of regularLines) {
        line.appliedPromoCode = promo.code;
      }
    }
  }

  const finalSubtotal = roundMoney(memberSubtotal - campaignDiscount - promoDiscount);
  const pricedLines = buildLines(allLines);

  return {
    lines: pricedLines,
    breakdown: { baseSubtotal, memberDiscount, campaignDiscount, promoDiscount, finalSubtotal },
    appliedCampaigns,
    needsFreeChoice,
    choiceContext,
    currencyCode,
  };
}
