import { adminGraphql } from "../shipping.server";

export type CampaignType =
  | "BuyXGetOneFree"
  | "BuyXGetZFree"
  | "BuyXGetZChoice"
  | "CartThresholdDiscount"
  | "CartThresholdFreeChoice";

export type CampaignBase = {
  id: string; // metaobject id
  type: CampaignType;
  label: string;
  priority: number;
  stackable: boolean;
};

export type Campaign =
  | (CampaignBase & {
      type: "BuyXGetOneFree";
      buyQuantity: number;
      eligibleVariantIds: string[];
    })
  | (CampaignBase & {
      type: "BuyXGetZFree";
      buyQuantity: number;
      triggerVariantIds: string[];
      freeVariantId: string;
    })
  | (CampaignBase & {
      type: "BuyXGetZChoice";
      buyQuantity: number;
      triggerVariantIds: string[];
      choiceVariantIds: string[];
    })
  | (CampaignBase & {
      type: "CartThresholdDiscount";
      thresholdAmount: number;
      discount: { type: "percentage" | "fixed"; value: number };
    })
  | (CampaignBase & {
      type: "CartThresholdFreeChoice";
      thresholdAmount: number;
      choiceVariantIds: string[];
    });

const METAOBJECT_TYPE = "mk_campaign";

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function ensureCampaignMetaobjectDefinition(admin: any) {
  // 1) check if definition exists
  const q = `#graphql
    query GetDef($type: String!) {
      metaobjectDefinition(type: $type) {
        id
        type
      }
    }
  `;
  const r = await adminGraphql(admin, q, { variables: { type: METAOBJECT_TYPE } });
  const j = await r.json();
  if (j?.data?.metaobjectDefinition?.id) return;

  // 2) create definition
  // Use simple string/number/boolean fields + configJson (string)
  const m = `#graphql
    mutation CreateDef($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition { id type }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    definition: {
      name: "MK Campaign",
      type: METAOBJECT_TYPE,
      fieldDefinitions: [
        { key: "label", name: "Label", type: "single_line_text_field", required: true },
        { key: "campaignType", name: "Type", type: "single_line_text_field", required: true },
        { key: "priority", name: "Priority", type: "number_integer", required: true },
        { key: "stackable", name: "Stackable", type: "boolean", required: true },
        { key: "configJson", name: "Config JSON", type: "multi_line_text_field", required: true },
      ],
      access: { admin: "PUBLIC_READ" },
    },
  };

  const rr = await adminGraphql(admin, m, { variables });
  const jj = await rr.json();
  const errs = jj?.data?.metaobjectDefinitionCreate?.userErrors ?? [];
  if (errs.length) {
    throw new Error("metaobjectDefinitionCreate failed: " + JSON.stringify(errs));
  }
}

export async function listCampaigns(admin: any): Promise<Campaign[]> {
  const q = `#graphql
    query ListCampaigns($type: String!) {
      metaobjects(type: $type, first: 250) {
        nodes {
          id
          fields {
            key
            value
          }
        }
      }
    }
  `;
  const r = await adminGraphql(admin, q, { variables: { type: METAOBJECT_TYPE } });
  const j = await r.json();
  const nodes = j?.data?.metaobjects?.nodes ?? [];

  return nodes
    .map((n: any) => {
      const map = new Map<string, string>();
      for (const f of n.fields ?? []) map.set(String(f.key), String(f.value ?? ""));

      const type = map.get("campaignType") as CampaignType;
      const label = map.get("label") || "";
      const priority = Number(map.get("priority") || 0);
      const stackable = String(map.get("stackable") || "false") === "true";
      const config = safeJsonParse<any>(map.get("configJson") || "{}", {});

      const base = { id: String(n.id), type, label, priority, stackable };

      switch (type) {
        case "BuyXGetOneFree":
          return {
            ...base,
            buyQuantity: Number(config.buyQuantity || 0),
            eligibleVariantIds: Array.isArray(config.eligibleVariantIds) ? config.eligibleVariantIds : [],
          };
        case "BuyXGetZFree":
          return {
            ...base,
            buyQuantity: Number(config.buyQuantity || 0),
            triggerVariantIds: Array.isArray(config.triggerVariantIds) ? config.triggerVariantIds : [],
            freeVariantId: String(config.freeVariantId || ""),
          };
        case "BuyXGetZChoice":
          return {
            ...base,
            buyQuantity: Number(config.buyQuantity || 0),
            triggerVariantIds: Array.isArray(config.triggerVariantIds) ? config.triggerVariantIds : [],
            choiceVariantIds: Array.isArray(config.choiceVariantIds) ? config.choiceVariantIds : [],
          };
        case "CartThresholdDiscount":
          return {
            ...base,
            thresholdAmount: Number(config.thresholdAmount || 0),
            discount: {
              type: config?.discount?.type === "fixed" ? "fixed" : "percentage",
              value: Number(config?.discount?.value || 0),
            },
          };
        case "CartThresholdFreeChoice":
          return {
            ...base,
            thresholdAmount: Number(config.thresholdAmount || 0),
            choiceVariantIds: Array.isArray(config.choiceVariantIds) ? config.choiceVariantIds : [],
          };
        default:
          return null;
      }
    })
    .filter(Boolean);
}

export async function getCampaign(admin: any, id: string) {
  const q = `#graphql
    query GetCampaign($id: ID!) {
      metaobject(id: $id) {
        id
        fields { key value }
      }
    }
  `;
  const r = await adminGraphql(admin, q, { variables: { id } });
  const j = await r.json();
  const mo = j?.data?.metaobject;
  if (!mo?.id) return null;

  const map = new Map<string, string>();
  for (const f of mo.fields ?? []) map.set(String(f.key), String(f.value ?? ""));
  return {
    id: String(mo.id),
    label: map.get("label") || "",
    campaignType: map.get("campaignType") || "",
    priority: map.get("priority") || "0",
    stackable: map.get("stackable") || "false",
    configJson: map.get("configJson") || "{}",
  };
}

export async function upsertCampaign(admin: any, input: {
  id?: string;
  label: string;
  campaignType: string;
  priority: number;
  stackable: boolean;
  configJson: string;
}) {
  const fields = [
    { key: "label", value: input.label },
    { key: "campaignType", value: input.campaignType },
    { key: "priority", value: String(input.priority) },
    { key: "stackable", value: input.stackable ? "true" : "false" },
    { key: "configJson", value: input.configJson },
  ];

  if (!input.id) {
    const m = `#graphql
      mutation CreateCampaign($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }
    `;
    const r = await adminGraphql(admin, m, {
      variables: { metaobject: { type: METAOBJECT_TYPE, fields } },
    });
    const j = await r.json();
    const errs = j?.data?.metaobjectCreate?.userErrors ?? [];
    if (errs.length) throw new Error(JSON.stringify(errs));
    return j?.data?.metaobjectCreate?.metaobject?.id as string;
  }

  const m = `#graphql
    mutation UpdateCampaign($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `;
  const r = await adminGraphql(admin, m, {
    variables: { id: input.id, metaobject: { fields } },
  });
  const j = await r.json();
  const errs = j?.data?.metaobjectUpdate?.userErrors ?? [];
  if (errs.length) throw new Error(JSON.stringify(errs));
  return input.id;
}

export async function deleteCampaign(admin: any, id: string) {
  const m = `#graphql
    mutation DeleteCampaign($id: ID!) {
      metaobjectDelete(id: $id) {
        deletedId
        userErrors { field message }
      }
    }
  `;
  const r = await adminGraphql(admin, m, { variables: { id } });
  const j = await r.json();
  const errs = j?.data?.metaobjectDelete?.userErrors ?? [];
  if (errs.length) throw new Error(JSON.stringify(errs));
}
