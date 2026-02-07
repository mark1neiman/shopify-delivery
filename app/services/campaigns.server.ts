// shopify-delivery/app/services/campaigns.server.ts
import { adminGraphql } from "../shipping.server";

export type CampaignType =
  | "BuyXGetOneFree"
  | "BuyXGetZFree"
  | "BuyXGetZChoice"
  | "CartThresholdDiscount"
  | "CartThresholdFreeChoice";

export type CampaignBase = {
  id: string;
  type: CampaignType;
  label: string;
  priority: number;
  stackable: boolean;
};

export type BuyXGetOneFreeCampaign = CampaignBase & {
  type: "BuyXGetOneFree";
  buyQuantity: number;
  eligibleVariantIds: string[]; // list of variant GIDs
};

export type BuyXGetZFreeCampaign = CampaignBase & {
  type: "BuyXGetZFree";
  buyQuantity: number;
  triggerVariantIds: string[]; // list of variant GIDs
  freeVariantId: string; // variant GID
};

export type BuyXGetZChoiceCampaign = CampaignBase & {
  type: "BuyXGetZChoice";
  buyQuantity: number;
  triggerVariantIds: string[]; // list of variant GIDs
  choiceVariantIds: string[]; // list of variant GIDs
};

export type CartThresholdDiscountCampaign = CampaignBase & {
  type: "CartThresholdDiscount";
  thresholdAmount: number; // in store currency units (e.g. 100 = €100)
  discount: {
    type: "percentage" | "fixed";
    value: number; // percent (10) or fixed (10)
  };
};

export type CartThresholdFreeChoiceCampaign = CampaignBase & {
  type: "CartThresholdFreeChoice";
  thresholdAmount: number;
  choiceVariantIds: string[];
};

export type Campaign =
  | BuyXGetOneFreeCampaign
  | BuyXGetZFreeCampaign
  | BuyXGetZChoiceCampaign
  | CartThresholdDiscountCampaign
  | CartThresholdFreeChoiceCampaign;

export const DEFAULT_CAMPAIGNS: Campaign[] = [
  {
    id: "bxgo-default",
    type: "BuyXGetOneFree",
    label: "Buy 2 get 1 free",
    priority: 10,
    stackable: true,
    buyQuantity: 2,
    eligibleVariantIds: [],
  },
  {
    id: "bxg-free-choice",
    type: "BuyXGetZChoice",
    label: "Buy 3 and choose a free gift",
    priority: 20,
    stackable: false,
    buyQuantity: 3,
    triggerVariantIds: [],
    choiceVariantIds: [],
  },
  {
    id: "threshold-10",
    type: "CartThresholdDiscount",
    label: "Spend 100 and save 10%",
    priority: 30,
    stackable: true,
    thresholdAmount: 100,
    discount: { type: "percentage", value: 10 },
  },
  {
    id: "threshold-free",
    type: "CartThresholdFreeChoice",
    label: "Spend 150 and choose a free gift",
    priority: 40,
    stackable: false,
    thresholdAmount: 150,
    choiceVariantIds: [],
  },
  {
    id: "bxg-z-free",
    type: "BuyXGetZFree",
    label: "Buy 2 and get a free add-on",
    priority: 50,
    stackable: true,
    buyQuantity: 2,
    triggerVariantIds: [],
    freeVariantId: "",
  },
];

const MF_NAMESPACE = "mk";
const MF_KEY = "campaigns";

// Basic sanitizers so broken JSON from UI won’t brick pricing.
function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asNumber(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function asBool(v: any, fallback: boolean) {
  return typeof v === "boolean" ? v : fallback;
}
function asString(v: any, fallback: string) {
  return typeof v === "string" ? v : fallback;
}
function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim().length > 0);
}

export function normalizeCampaigns(raw: unknown): Campaign[] {
  if (!Array.isArray(raw)) return DEFAULT_CAMPAIGNS;

  const out: Campaign[] = [];

  for (const item of raw) {
    if (!isObject(item)) continue;

    const type = item.type as CampaignType;
    const base: CampaignBase = {
      id: asString(item.id, ""),
      type,
      label: asString(item.label, ""),
      priority: asNumber(item.priority, 100),
      stackable: asBool(item.stackable, true),
    };

    if (!base.id || !base.type) continue;

    if (type === "BuyXGetOneFree") {
      out.push({
        ...base,
        type,
        buyQuantity: asNumber(item.buyQuantity, 2),
        eligibleVariantIds: asStringArray(item.eligibleVariantIds),
      });
      continue;
    }

    if (type === "BuyXGetZFree") {
      out.push({
        ...base,
        type,
        buyQuantity: asNumber(item.buyQuantity, 2),
        triggerVariantIds: asStringArray(item.triggerVariantIds),
        freeVariantId: asString(item.freeVariantId, ""),
      });
      continue;
    }

    if (type === "BuyXGetZChoice") {
      out.push({
        ...base,
        type,
        buyQuantity: asNumber(item.buyQuantity, 3),
        triggerVariantIds: asStringArray(item.triggerVariantIds),
        choiceVariantIds: asStringArray(item.choiceVariantIds),
      });
      continue;
    }

    if (type === "CartThresholdDiscount") {
      const discountType =
        item?.discount?.type === "fixed" ? "fixed" : "percentage";
      out.push({
        ...base,
        type,
        thresholdAmount: asNumber(item.thresholdAmount, 100),
        discount: {
          type: discountType,
          value: asNumber(item?.discount?.value, 10),
        },
      });
      continue;
    }

    if (type === "CartThresholdFreeChoice") {
      out.push({
        ...base,
        type,
        thresholdAmount: asNumber(item.thresholdAmount, 150),
        choiceVariantIds: asStringArray(item.choiceVariantIds),
      });
      continue;
    }
  }

  // Ensure stable order if someone saved duplicates or garbage:
  return out.sort((a, b) => a.priority - b.priority);
}

export async function getCampaigns(admin: any): Promise<Campaign[]> {
  const query = `#graphql
    query GetCampaignsMetafield {
      shop {
        metafield(namespace: "${MF_NAMESPACE}", key: "${MF_KEY}") {
          id
          type
          value
        }
      }
    }
  `;

  try {
    const res = await adminGraphql(admin, query);
    const json = await res.json();
    const value = json?.data?.shop?.metafield?.value;

    if (!value) return DEFAULT_CAMPAIGNS;

    const parsed = JSON.parse(value);
    return normalizeCampaigns(parsed);
  } catch {
    return DEFAULT_CAMPAIGNS;
  }
}

export async function saveCampaigns(admin: any, campaigns: Campaign[]) {
  const mutation = `#graphql
    mutation SetCampaigns($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key type value }
        userErrors { field message }
      }
    }
  `;

  const normalized = normalizeCampaigns(campaigns);

  const variables = {
    metafields: [
      {
        namespace: MF_NAMESPACE,
        key: MF_KEY,
        type: "json",
        value: JSON.stringify(normalized),
        ownerId: "gid://shopify/Shop/1", // IMPORTANT: we will overwrite this in code below
      },
    ],
  };

  // We must use the real shop ID, so fetch it once:
  const shopIdQuery = `#graphql
    query ShopId {
      shop { id }
    }
  `;
  const shopRes = await adminGraphql(admin, shopIdQuery);
  const shopJson = await shopRes.json();
  const shopId = shopJson?.data?.shop?.id;

  if (!shopId) {
    throw new Error("Cannot resolve shop.id for metafieldsSet");
  }

  variables.metafields[0].ownerId = shopId;

  const res = await adminGraphql(admin, mutation, { variables });
  const json = await res.json();
  const errs = json?.data?.metafieldsSet?.userErrors ?? [];
  if (errs.length) {
    throw new Error(errs.map((e: any) => e.message).join("; "));
  }

  return normalized;
}
