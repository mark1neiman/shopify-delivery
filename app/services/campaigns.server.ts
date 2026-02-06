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
  eligibleVariantIds: string[];
};

export type BuyXGetZFreeCampaign = CampaignBase & {
  type: "BuyXGetZFree";
  buyQuantity: number;
  triggerVariantIds: string[];
  freeVariantId: string;
};

export type BuyXGetZChoiceCampaign = CampaignBase & {
  type: "BuyXGetZChoice";
  buyQuantity: number;
  triggerVariantIds: string[];
  choiceVariantIds: string[];
};

export type CartThresholdDiscountCampaign = CampaignBase & {
  type: "CartThresholdDiscount";
  thresholdAmount: number;
  discount: {
    type: "percentage" | "fixed";
    value: number;
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

export const CAMPAIGNS: Campaign[] = [
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
