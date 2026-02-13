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
  promo: {
    requestedCode: string | null;
    appliedCode: string | null;
    label: string | null;
    discount: number;
    reason: string | null;
  };
  needsFreeChoice: boolean;
  choiceContext?: {
    campaignId: string;
    label: string;
    choices: string[];
    giftQty?: number;
    choiceOptions?: Array<{
      variantId: string;
      label: string;
      price?: number;
      currencyCode?: string;
    }>;
    selectedChoices?: string[];
  };
  currencyCode: string;
};

export type PricingInput = {
  items: { variantId: string; quantity: number }[];
  customerId: string | null;
  promoCode: string | null;
  freeChoiceVariantId: string | null;
  freeChoiceSelections?: string[] | null;
};

const SETTINGS_NAMESPACE = "mkx";
const SETTINGS_KEY = "pricing_settings";
const DEFAULT_LOGGED_IN_DISCOUNT_PERCENT = 15;

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

function toCustomerGid(rawId: string | null | undefined) {
  const id = String(rawId || "").trim();
  if (!id) return "";
  if (id.startsWith("gid://")) return id;
  const numeric = id.replace(/[^\d]/g, "");
  if (!numeric) return "";
  return `gid://shopify/Customer/${numeric}`;
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

type PromoCodeDefinition = {
  code: string;
  title: string | null;
  type: "percentage" | "fixed";
  value: number;
  stackable: boolean;
  startsAt: string | null;
  endsAt: string | null;
  minimumSubtotal: number;
  minimumQuantity: number;
  customerSelectionType: "all" | "customers" | "segments";
  customerIds: Set<string>;
  itemSelectionType: "all" | "products" | "collections";
  productIds: Set<string>;
  variantIds: Set<string>;
  collectionIds: Set<string>;
};

type VariantPromoMeta = {
  productId: string;
  collectionIds: Set<string>;
};

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

type VariantLabelMap = Map<string, string>;

async function fetchVariantLabels(admin: any, variantIds: string[]): Promise<VariantLabelMap> {
  const ids = Array.from(new Set((variantIds || []).map((id) => toGid(id)).filter(Boolean)));
  const out: VariantLabelMap = new Map();
  if (!ids.length) return out;

  const query = `#graphql
    query VariantLabels($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          title
          product { title }
        }
      }
    }
  `;

  try {
    const res = await adminGraphql(admin, query, { variables: { ids } });
    const json = await res.json();
    const nodes = json?.data?.nodes || [];

    for (const node of nodes) {
      const id = String(node?.id || "");
      if (!id) continue;

      const productTitle = String(node?.product?.title || "").trim();
      const variantTitle = String(node?.title || "").trim();
      const hasSpecificVariant = variantTitle && variantTitle.toLowerCase() !== "default title";
      const label = productTitle
        ? hasSpecificVariant
          ? `${productTitle} - ${variantTitle}`
          : productTitle
        : variantTitle || id;

      out.set(id, label);
    }
  } catch {
    return out;
  }

  return out;
}

async function fetchVariantPromoMeta(admin: any, variantIds: string[]): Promise<Map<string, VariantPromoMeta>> {
  const ids = Array.from(new Set((variantIds || []).map((id) => toGid(id)).filter(Boolean)));
  const out = new Map<string, VariantPromoMeta>();
  if (!ids.length) return out;

  const query = `#graphql
    query VariantPromoMeta($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          product {
            id
            collections(first: 100) {
              nodes { id }
            }
          }
        }
      }
    }
  `;

  try {
    const res = await adminGraphql(admin, query, { variables: { ids } });
    const json = await res.json();
    const nodes = json?.data?.nodes || [];

    for (const node of nodes) {
      const variantId = String(node?.id || "");
      if (!variantId) continue;
      const productId = String(node?.product?.id || "");
      const collections = Array.isArray(node?.product?.collections?.nodes) ? node.product.collections.nodes : [];
      const collectionIds = new Set<string>(
        collections.map((c: any) => String(c?.id || "").trim()).filter(Boolean),
      );

      out.set(variantId, { productId, collectionIds });
    }
  } catch {
    return out;
  }

  return out;
}

function buildChoiceOptions(
  choiceIds: string[],
  priceMap: PriceMap,
  labelMap: VariantLabelMap,
): Array<{ variantId: string; label: string; price?: number; currencyCode?: string }> {
  const out: Array<{ variantId: string; label: string; price?: number; currencyCode?: string }> = [];
  const seen = new Set<string>();

  for (const raw of choiceIds || []) {
    const variantId = toGid(raw);
    if (!variantId || seen.has(variantId)) continue;
    seen.add(variantId);

    const price = priceMap.get(variantId);
    out.push({
      variantId,
      label: labelMap.get(variantId) || variantId,
      price: Number.isFinite(Number(price?.amount)) ? Number(price?.amount) : undefined,
      currencyCode: price?.currencyCode ? String(price.currencyCode) : undefined,
    });
  }

  return out;
}

async function fetchLoggedInDiscountRate(admin: any): Promise<number> {
  const query = `#graphql
    query PricingSettings {
      shop {
        metafield(namespace: "${SETTINGS_NAMESPACE}", key: "${SETTINGS_KEY}") {
          value
        }
      }
    }
  `;

  try {
    const res = await adminGraphql(admin, query);
    const json = await res.json();
    const rawValue = json?.data?.shop?.metafield?.value;
    const parsed = rawValue ? JSON.parse(rawValue) : {};

    const percentRaw = Number(
      parsed?.loggedInDiscountPercent ?? parsed?.memberDiscountPercent ?? DEFAULT_LOGGED_IN_DISCOUNT_PERCENT,
    );
    const percent = Number.isFinite(percentRaw) ? percentRaw : DEFAULT_LOGGED_IN_DISCOUNT_PERCENT;
    const clamped = Math.max(0, Math.min(100, percent));
    return clamped / 100;
  } catch {
    return DEFAULT_LOGGED_IN_DISCOUNT_PERCENT / 100;
  }
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

function applyMemberDiscount(lines: Map<string, LineState>, hasMember: boolean, discountRate: number) {
  if (!hasMember) return;
  const rate = Math.max(0, Math.min(1, Number(discountRate || 0)));
  for (const line of lines.values()) {
    // ✅ do not apply member discount to gift line (cosmetic; gift is already free)
    if (line.isGiftLine) continue;
    line.memberUnitPrice = roundMoney(line.baseUnitPrice * (1 - rate));
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

function paidUnitsForLine(line: LineState) {
  return Math.max(0, Number(line.quantity || 0) - Number(line.freeUnits || 0));
}

function applyLineFreeUnits(line: LineState, quantity: number, campaign: Campaign) {
  const qty = Math.max(0, Number(quantity || 0));
  if (qty <= 0) return;

  line.discountTotal += line.memberUnitPrice * qty;
  line.freeUnits += qty;

  line.appliedCampaignIds.add(campaign.id);
  line.appliedCampaignLabels.add(campaign.label);

  // ✅ mark allocated free units for UI/debug payload
  line.campaignQuantities[campaign.id] = Number(line.campaignQuantities[campaign.id] || 0) + qty;
}

function applyFreeUnits(lines: LineState[], freeCount: number, campaign: Campaign) {
  if (freeCount <= 0) return;

  const unitPool: { line: LineState; unitPrice: number; sourceQty: number; order: number }[] = [];
  let order = 0;
  for (const line of lines) {
    const paidUnits = paidUnitsForLine(line);
    for (let i = 0; i < paidUnits; i += 1) {
      unitPool.push({
        line,
        unitPrice: line.memberUnitPrice,
        sourceQty: Math.max(0, Number(line.quantity || 0)),
        order: order++,
      });
    }
  }

  // Deterministic tie-breaker:
  // 1) cheaper units first
  // 2) if same price, prefer lines with smaller quantity (keeps FREE line stable in mixed carts)
  // 3) preserve original pool order
  unitPool.sort((a, b) => {
    const byPrice = a.unitPrice - b.unitPrice;
    if (byPrice !== 0) return byPrice;
    const byQty = a.sourceQty - b.sourceQty;
    if (byQty !== 0) return byQty;
    return a.order - b.order;
  });
  const freebies = unitPool.slice(0, freeCount);

  for (const freeUnit of freebies) {
    applyLineFreeUnits(freeUnit.line, 1, campaign);
  }
}

function applyBuyXGetOneFree(lines: LineState[], setSize: number, campaign: Campaign) {
  const normalizedSetSize = Math.max(0, Number(setSize || 0));
  if (normalizedSetSize <= 0) return 0;

  const totalPaidEligibleQty = sum(lines.map((line) => paidUnitsForLine(line)));
  const totalFreeCount = Math.floor(totalPaidEligibleQty / normalizedSetSize);
  if (totalFreeCount <= 0) return 0;

  // Step 1:
  // If a single line already forms full sets on its own (e.g. 4+4 with X=4),
  // grant those free units on that line first to avoid ambiguous cross-line allocation.
  let granted = 0;
  for (const line of lines) {
    const linePaidQty = paidUnitsForLine(line);
    const lineFreeCount = Math.floor(linePaidQty / normalizedSetSize);
    if (lineFreeCount <= 0) continue;

    applyLineFreeUnits(line, lineFreeCount, campaign);
    granted += lineFreeCount;
  }

  // Step 2:
  // Remaining free units come from mixed "leftover" units across lines by cheapest-first logic.
  const remainingFree = totalFreeCount - granted;
  if (remainingFree > 0) {
    applyFreeUnits(lines, remainingFree, campaign);
    granted += remainingFree;
  }

  return granted;
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

async function validatePromoCode(admin: any, code: string): Promise<PromoCodeDefinition | null> {
  const queryFull = `#graphql
    query PromoCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            title
            startsAt
            endsAt
            customerSelection {
              __typename
              ... on DiscountCustomerAll {
                allCustomers
              }
              ... on DiscountCustomers {
                customers(first: 250) {
                  nodes { id }
                }
              }
              ... on DiscountCustomerSegments {
                segments {
                  id
                }
              }
            }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal {
                  amount
                  currencyCode
                }
              }
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            customerGets {
              value {
                __typename
                ... on DiscountPercentage {
                  percentage
                }
                ... on DiscountAmount {
                  amount {
                    amount
                    currencyCode
                  }
                }
              }
              items {
                __typename
                ... on AllDiscountItems {
                  allItems
                }
                ... on DiscountProducts {
                  products(first: 250) {
                    nodes { id }
                  }
                  productVariants(first: 250) {
                    nodes { id }
                  }
                }
                ... on DiscountCollections {
                  collections(first: 250) {
                    nodes { id }
                  }
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

  const queryFallback = `#graphql
    query PromoCodeFallback($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            title
            startsAt
            endsAt
            customerGets {
              value {
                __typename
                ... on DiscountPercentage {
                  percentage
                }
                ... on DiscountAmount {
                  amount {
                    amount
                    currencyCode
                  }
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
    const normalizedCode = String(code || "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();
    if (!normalizedCode) return null;

    function buildPromo(discount: any, strict: boolean): PromoCodeDefinition | null {
      if (!discount || discount?.__typename !== "DiscountCodeBasic") return null;

      const value = discount?.customerGets?.value;
      const combinesWith = discount?.combinesWith ?? { orderDiscounts: true, productDiscounts: true };
      const stackable = Boolean(combinesWith.orderDiscounts || combinesWith.productDiscounts);

      let type: "percentage" | "fixed" | null = null;
      let numericValue = 0;
      if (value?.__typename === "DiscountPercentage") {
        const rawPercent = Number(value?.percentage ?? 0);
        type = "percentage";
        numericValue = rawPercent > 1 ? rawPercent : rawPercent * 100;
      } else if (value?.__typename === "DiscountAmount") {
        type = "fixed";
        numericValue = Number(value?.amount?.amount ?? 0);
      }
      if (!type || !Number.isFinite(numericValue) || numericValue <= 0) return null;

      const customerSelection = strict ? discount?.customerSelection : null;
      const customerSelectionType: PromoCodeDefinition["customerSelectionType"] =
        customerSelection?.__typename === "DiscountCustomers"
          ? "customers"
          : customerSelection?.__typename === "DiscountCustomerSegments"
            ? "segments"
            : "all";
      const customerIds = new Set<string>();
      if (customerSelection?.__typename === "DiscountCustomers") {
        const nodes = customerSelection?.customers?.nodes || [];
        for (const n of nodes) {
          const customerId = toCustomerGid(String(n?.id || ""));
          if (customerId) customerIds.add(customerId);
        }
      }

      let minimumSubtotal = 0;
      let minimumQuantity = 0;
      const minimumRequirement = strict ? discount?.minimumRequirement : null;
      if (minimumRequirement?.__typename === "DiscountMinimumSubtotal") {
        minimumSubtotal = Number(minimumRequirement?.greaterThanOrEqualToSubtotal?.amount ?? 0);
      } else if (minimumRequirement?.__typename === "DiscountMinimumQuantity") {
        minimumQuantity = Number(minimumRequirement?.greaterThanOrEqualToQuantity ?? 0);
      }
      if (!Number.isFinite(minimumSubtotal) || minimumSubtotal < 0) minimumSubtotal = 0;
      if (!Number.isFinite(minimumQuantity) || minimumQuantity < 0) minimumQuantity = 0;

      const items = strict ? discount?.customerGets?.items : null;
      const itemSelectionType: PromoCodeDefinition["itemSelectionType"] =
        items?.__typename === "DiscountProducts"
          ? "products"
          : items?.__typename === "DiscountCollections"
            ? "collections"
            : "all";

      const productIds = new Set<string>();
      const variantIds = new Set<string>();
      const collectionIds = new Set<string>();

      if (items?.__typename === "DiscountProducts") {
        const products = Array.isArray(items?.products?.nodes) ? items.products.nodes : [];
        const variants = Array.isArray(items?.productVariants?.nodes) ? items.productVariants.nodes : [];
        products.forEach((p: any) => {
          const id = String(p?.id || "").trim();
          if (id) productIds.add(id);
        });
        variants.forEach((v: any) => {
          const id = toGid(String(v?.id || ""));
          if (id) variantIds.add(id);
        });
      }

      if (items?.__typename === "DiscountCollections") {
        const collections = Array.isArray(items?.collections?.nodes) ? items.collections.nodes : [];
        collections.forEach((c: any) => {
          const id = String(c?.id || "").trim();
          if (id) collectionIds.add(id);
        });
      }

      return {
        code: normalizedCode,
        title: String(discount?.title || "").trim() || null,
        type,
        value: numericValue,
        stackable,
        startsAt: discount?.startsAt ? String(discount.startsAt) : null,
        endsAt: discount?.endsAt ? String(discount.endsAt) : null,
        minimumSubtotal,
        minimumQuantity,
        customerSelectionType,
        customerIds,
        itemSelectionType,
        productIds,
        variantIds,
        collectionIds,
      };
    }

    let discount: any = null;
    let strict = true;

    try {
      const res = await adminGraphql(admin, queryFull, { variables: { code: normalizedCode } });
      const json = await res.json();
      const hasErrors = Array.isArray(json?.errors) && json.errors.length > 0;
      if (hasErrors) {
        try {
          console.warn("[pricing] promo full query errors", {
            code: normalizedCode,
            errors: json.errors?.map((e: any) => String(e?.message || "")).slice(0, 5),
          });
        } catch {}
      }
      discount = json?.data?.codeDiscountNodeByCode?.codeDiscount || null;
      if (!discount || hasErrors) {
        strict = false;
      }
    } catch {
      strict = false;
    }

    if (!discount || !strict) {
      const resFallback = await adminGraphql(admin, queryFallback, { variables: { code: normalizedCode } });
      const jsonFallback = await resFallback.json();
      if (Array.isArray(jsonFallback?.errors) && jsonFallback.errors.length) {
        try {
          console.warn("[pricing] promo fallback query errors", {
            code: normalizedCode,
            errors: jsonFallback.errors?.map((e: any) => String(e?.message || "")).slice(0, 5),
          });
        } catch {}
      }
      discount = jsonFallback?.data?.codeDiscountNodeByCode?.codeDiscount || discount;
      strict = false;
    }

    return buildPromo(discount, strict);
  } catch {
    return null;
  }
}

function promoIsActiveNow(promo: PromoCodeDefinition) {
  const nowTs = Date.now();
  const startsAtTs = promo.startsAt ? Date.parse(promo.startsAt) : NaN;
  const endsAtTs = promo.endsAt ? Date.parse(promo.endsAt) : NaN;

  if (Number.isFinite(startsAtTs) && nowTs < startsAtTs) return false;
  if (Number.isFinite(endsAtTs) && nowTs > endsAtTs) return false;
  return true;
}

function lineMatchesPromoScope(
  line: LineState,
  promo: PromoCodeDefinition,
  variantPromoMeta: Map<string, VariantPromoMeta>,
) {
  if (line.isGiftLine) return false;
  if (promo.itemSelectionType === "all") return true;

  const variantId = toGid(line.variantId);
  if (promo.variantIds.has(variantId)) return true;

  const meta = variantPromoMeta.get(variantId);
  if (!meta) return false;

  if (promo.productIds.size && promo.productIds.has(meta.productId)) return true;

  if (promo.collectionIds.size) {
    for (const collectionId of meta.collectionIds) {
      if (promo.collectionIds.has(collectionId)) return true;
    }
  }

  return false;
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
  const normalizedFreeChoiceSelections = Array.isArray(input.freeChoiceSelections)
    ? input.freeChoiceSelections.map((id) => toGid(id)).filter(Boolean)
    : [];

  const campaignsFromAdmin = await getCampaigns(admin);

  const choiceVariantIdsFromCampaigns = campaignsFromAdmin
    .flatMap((campaign) => {
      if (campaign.type === "BuyXGetZChoice") return campaign.choiceVariantIds;
      if (campaign.type === "CartThresholdFreeChoice") return campaign.choiceVariantIds;
      return [];
    })
    .filter(Boolean);

  const campaignVariantIds = campaignsFromAdmin
    .flatMap((campaign) => {
      if (campaign.type === "BuyXGetZFree") return [campaign.freeVariantId];
      if (campaign.type === "BuyXGetZChoice") return campaign.choiceVariantIds;
      if (campaign.type === "CartThresholdFreeChoice") return campaign.choiceVariantIds;
      return [];
    })
    .filter(Boolean);

  const extraVariantIds = [input.freeChoiceVariantId ?? "", ...normalizedFreeChoiceSelections, ...campaignVariantIds].filter(
    Boolean,
  );

  const variantIds = Array.from(new Set([...normalizedItems.map((i) => i.variantId), ...extraVariantIds]));
  const priceMap = await fetchVariantPrices(admin, variantIds);
  const choiceLabelMap = await fetchVariantLabels(admin, choiceVariantIdsFromCampaigns);

  const first = priceMap.values().next().value as { amount: number; currencyCode: string } | undefined;
  const currencyCode = first?.currencyCode ?? "USD";

  const linesMap = new Map<string, LineState>();

  // ✅ build regular lines first
  for (const item of normalizedItems) {
    ensureRegularLine(linesMap, item.variantId, priceMap, item.quantity);
  }

  const loggedInDiscountRate = await fetchLoggedInDiscountRate(admin);
  applyMemberDiscount(linesMap, Boolean(input.customerId), loggedInDiscountRate);

  const appliedCampaigns: { id: string; type: Campaign["type"]; label: string }[] = [];
  let needsFreeChoice = false;
  let choiceContext: PricingResult["choiceContext"];

  const campaigns = [...campaignsFromAdmin].sort((a, b) => a.priority - b.priority);

  let hasNonStackable = false;

  for (const campaign of campaigns) {
    if (hasNonStackable && !campaign.stackable) continue;

    const allLines = Array.from(linesMap.values());
    const regularLines = allLines.filter((l) => !l.isGiftLine);

    // ✅ regular subtotal before campaign discounts (but after member pricing)
    const memberSubtotal = sum(regularLines.map((l) => l.memberUnitPrice * l.quantity));
    // ✅ current payable subtotal after already-applied campaign discounts
    const payableSubtotal = sum(regularLines.map((l) => totalLineValue(l)));

    if (campaign.type === "BuyXGetOneFree") {
      const eligible = eligibleUnits(regularLines, campaign.eligibleVariantIds);
      const setSize = Math.max(0, Number(campaign.buyQuantity || 0));
      if (setSize <= 0) continue;

      const granted = applyBuyXGetOneFree(eligible, setSize, campaign);
      if (granted <= 0) continue;

      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (campaign.type === "BuyXGetZFree") {
      if (!campaign.freeVariantId) continue;

      const eligible = eligibleUnits(regularLines, campaign.triggerVariantIds);
      const totalEligibleQty = sum(eligible.map((l) => l.quantity));
      const buyQty = Math.max(0, Number(campaign.buyQuantity || 0));
      if (buyQty <= 0 || totalEligibleQty < buyQty) continue;
      const giftQty = Math.floor(totalEligibleQty / buyQty);
      if (giftQty <= 0) continue;

      // allocate trigger units proportional to number of granted gifts
      allocateCampaignUnits(eligible, campaign, buyQty * giftQty);

      createGiftLine(linesMap, campaign, campaign.freeVariantId, priceMap, giftQty);
      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (campaign.type === "BuyXGetZChoice") {
      if (!campaign.choiceVariantIds.length) continue;

      const eligible = eligibleUnits(regularLines, campaign.triggerVariantIds);
      const totalEligibleQty = sum(eligible.map((l) => l.quantity));
      const buyQty = Math.max(0, Number(campaign.buyQuantity || 0));
      if (buyQty <= 0 || totalEligibleQty < buyQty) continue;
      const giftQty = Math.floor(totalEligibleQty / buyQty);
      if (giftQty <= 0) continue;

      const allowedChoices = campaign.choiceVariantIds.map(toGid);
      const choiceOptions = buildChoiceOptions(allowedChoices, priceMap, choiceLabelMap);
      const allowedSet = new Set(allowedChoices);
      const preferredSingle = toGid(input.freeChoiceVariantId || "");
      const preferredSelections = normalizedFreeChoiceSelections.filter((id) => allowedSet.has(id));
      const selectedChoices = preferredSelections.length
        ? preferredSelections.slice(0, giftQty)
        : preferredSingle && allowedSet.has(preferredSingle)
          ? [preferredSingle]
          : [allowedChoices[0]];

      while (selectedChoices.length < giftQty) {
        selectedChoices.push(selectedChoices[0] || allowedChoices[0]);
      }

      choiceContext = {
        campaignId: campaign.id,
        label: campaign.label,
        choices: allowedChoices,
        giftQty,
        choiceOptions,
        selectedChoices,
      };

      const giftCountByVariant = new Map<string, number>();
      selectedChoices.forEach((variantId) => {
        const prev = giftCountByVariant.get(variantId) || 0;
        giftCountByVariant.set(variantId, prev + 1);
      });

      // allocate trigger units proportional to number of granted gifts
      allocateCampaignUnits(eligible, campaign, buyQty * giftQty);

      giftCountByVariant.forEach((qty, variantId) => {
        if (qty > 0) createGiftLine(linesMap, campaign, variantId, priceMap, qty);
      });
      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (campaign.type === "CartThresholdDiscount") {
      if (payableSubtotal < campaign.thresholdAmount) continue;

      let discountAmount = 0;
      if (campaign.discount.type === "percentage") {
        discountAmount = roundMoney(payableSubtotal * (campaign.discount.value / 100));
      } else {
        discountAmount = campaign.discount.value;
      }

      // ✅ discount applies only to regular lines
      distributeDiscount(regularLines, discountAmount, campaign);

      appliedCampaigns.push({ id: campaign.id, type: campaign.type, label: campaign.label });
    }

    if (campaign.type === "CartThresholdFreeChoice") {
      const thresholdAmount = Math.max(0, Number(campaign.thresholdAmount || 0));
      if (thresholdAmount <= 0 || payableSubtotal < thresholdAmount) continue;
      if (!campaign.choiceVariantIds.length) continue;

      const allowedChoices = campaign.choiceVariantIds.map(toGid);
      const choiceOptions = buildChoiceOptions(allowedChoices, priceMap, choiceLabelMap);
      const allowedSet = new Set(allowedChoices);
      const preferredSingle = toGid(input.freeChoiceVariantId || "");
      const preferredSelections = normalizedFreeChoiceSelections.filter((id) => allowedSet.has(id));
      const baseGiftQty = Math.max(1, Number(campaign.giftQuantity || 1));
      const thresholdHits = campaign.repeatPerThreshold ? Math.floor(payableSubtotal / thresholdAmount) : 1;
      const giftQty = Math.max(0, baseGiftQty * Math.max(1, thresholdHits));
      if (giftQty <= 0) continue;

      const selectedChoices = preferredSelections.length
        ? preferredSelections.slice(0, giftQty)
        : preferredSingle && allowedSet.has(preferredSingle)
          ? [preferredSingle]
          : [allowedChoices[0]];

      while (selectedChoices.length < giftQty) {
        selectedChoices.push(selectedChoices[0] || allowedChoices[0]);
      }

      choiceContext = {
        campaignId: campaign.id,
        label: campaign.label,
        choices: allowedChoices,
        giftQty,
        choiceOptions,
        selectedChoices,
      };

      const giftCountByVariant = new Map<string, number>();
      selectedChoices.forEach((variantId) => {
        const prev = giftCountByVariant.get(variantId) || 0;
        giftCountByVariant.set(variantId, prev + 1);
      });

      giftCountByVariant.forEach((qty, variantId) => {
        if (qty > 0) createGiftLine(linesMap, campaign, variantId, priceMap, qty);
      });

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

  const requestedPromoCode = String(input.promoCode || "").trim() || null;
  let promoDiscount = 0;
  let promoAppliedCode: string | null = null;
  let promoLabel: string | null = null;
  let promoReason: string | null = null;

  if (!needsFreeChoice && requestedPromoCode) {
    const promo = await validatePromoCode(admin, requestedPromoCode);
    if (!promo) {
      promoReason = "Promo code is invalid or unsupported.";
    } else if (!promo.stackable && appliedCampaigns.length > 0) {
      promoReason = "Promo code cannot be combined with active campaigns.";
    } else if (!promoIsActiveNow(promo)) {
      promoReason = "Promo code is not active for the current date.";
    } else if (promo.customerSelectionType === "segments") {
      promoReason = "Promo code is limited to a customer segment.";
    } else {
      const customerId = toCustomerGid(input.customerId);
      if (promo.customerSelectionType === "customers") {
        if (!customerId || !promo.customerIds.has(customerId)) {
          promoReason = "Promo code is not available for this customer.";
        }
      }

      if (!promoReason) {
        let variantPromoMeta = new Map<string, VariantPromoMeta>();
        if (promo.itemSelectionType !== "all") {
          variantPromoMeta = await fetchVariantPromoMeta(
            admin,
            regularLines.map((line) => line.variantId),
          );
        }

        const eligiblePromoLines = regularLines.filter((line) =>
          lineMatchesPromoScope(line, promo, variantPromoMeta),
        );
        const eligiblePromoSubtotal = roundMoney(
          sum(eligiblePromoLines.map((line) => Math.max(0, totalLineValue(line)))),
        );
        const eligiblePromoQuantity = sum(eligiblePromoLines.map((line) => Math.max(0, line.quantity)));

        if (!eligiblePromoLines.length || eligiblePromoSubtotal <= 0) {
          promoReason = "Promo code does not apply to products in the cart.";
        } else if (promo.minimumSubtotal > 0 && eligiblePromoSubtotal < promo.minimumSubtotal) {
          promoReason = "Cart does not meet promo minimum subtotal requirement.";
        } else if (promo.minimumQuantity > 0 && eligiblePromoQuantity < promo.minimumQuantity) {
          promoReason = "Cart does not meet promo minimum quantity requirement.";
        } else {
          if (promo.type === "percentage") {
            promoDiscount = roundMoney(eligiblePromoSubtotal * (promo.value / 100));
          } else {
            promoDiscount = roundMoney(Math.min(promo.value, eligiblePromoSubtotal));
          }

          if (promoDiscount > 0) {
            distributeDiscount(eligiblePromoLines, promoDiscount);
            for (const line of eligiblePromoLines) {
              line.appliedPromoCode = promo.code;
            }
            promoAppliedCode = promo.code;
            promoLabel = promo.title;
          }
        }
      }
    }
  }

  const finalSubtotal = roundMoney(Math.max(0, memberSubtotal - campaignDiscount - promoDiscount));
  const pricedLines = buildLines(allLines);

  return {
    lines: pricedLines,
    breakdown: { baseSubtotal, memberDiscount, campaignDiscount, promoDiscount, finalSubtotal },
    appliedCampaigns,
    promo: {
      requestedCode: requestedPromoCode,
      appliedCode: promoAppliedCode,
      label: promoLabel,
      discount: promoDiscount,
      reason: promoReason,
    },
    needsFreeChoice,
    choiceContext,
    currencyCode,
  };
}
