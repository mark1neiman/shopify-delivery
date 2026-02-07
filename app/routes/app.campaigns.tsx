import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Select,
  Button,
  InlineStack,
  BlockStack,
  Divider,
  Banner,
} from "@shopify/polaris";
import * as React from "react";
import { authenticate } from "../shopify.server";
import { adminGraphql } from "../shipping.server";

/* =============================================================================
 * Types
 * ========================================================================== */

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

type LoaderData = {
  campaigns: Campaign[];
  metafieldId: string | null;
  shopId: string;
};

type ActionData =
  | { ok: true }
  | { ok: false; error: string };

/* =============================================================================
 * Storage (Shop metafield: mk.campaigns)
 * ========================================================================== */

const META_NAMESPACE = "mk";
const META_KEY = "campaigns";
const META_TYPE = "json";

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toGidVariant(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("gid://")) return s;
  // allow "123456789"
  return `gid://shopify/ProductVariant/${s.replace(/[^\d]/g, "")}`;
}

function variantIdsToText(ids: string[]): string {
  return (ids || []).join("\n");
}

type VariantOption = {
  id: string;
  title: string;
  sku?: string;
};

type VariantPickerProps = {
  label: string;
  selectedIds: string[];
  onChange: (next: string[]) => void;
  single?: boolean;
  helpText?: string;
};

function VariantPicker({ label, selectedIds, onChange, single = false, helpText }: VariantPickerProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<VariantOption[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  async function runSearch(nextQuery: string) {
    const q = nextQuery.trim();
    if (!q) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/app/api/variants?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      setResults(
        items.map((item: any) => ({
          id: String(item.id),
          title: String(item.title || item.id),
          sku: item.sku ? String(item.sku) : undefined,
        })),
      );
    } finally {
      setIsLoading(false);
    }
  }

  function addVariant(id: string) {
    if (single) {
      onChange([id]);
      return;
    }
    if (selectedIds.includes(id)) return;
    onChange([...selectedIds, id]);
  }

  function removeVariant(id: string) {
    onChange(selectedIds.filter((variantId) => variantId !== id));
  }

  return (
    <BlockStack gap="200">
      <TextField
        label={label}
        value={query}
        onChange={(value: string) => {
          setQuery(value);
          runSearch(value);
        }}
        autoComplete="off"
        helpText={helpText}
        placeholder="Start typing to search products"
      />

      {isLoading ? (
        <Text as="p" tone="subdued">
          Searching...
        </Text>
      ) : null}

      {results.length > 0 ? (
        <Card padding="200" background="bg-surface-secondary">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Results
            </Text>
            <BlockStack gap="150">
              {results.map((item) => (
                <InlineStack key={item.id} align="space-between" blockAlign="center" gap="200">
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm">
                      {item.title}
                    </Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {item.sku ? `${item.sku} • ${item.id}` : item.id}
                    </Text>
                  </BlockStack>
                  <Button size="slim" onClick={() => addVariant(item.id)}>
                    Add
                  </Button>
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
      ) : null}

      <BlockStack gap="150">
        {selectedIds.length === 0 ? (
          <Text as="p" tone="subdued">
            No variants selected yet.
          </Text>
        ) : (
          selectedIds.map((id) => (
            <InlineStack key={id} align="space-between" blockAlign="center" gap="200">
              <Text as="span" variant="bodySm">
                {id}
              </Text>
              <Button size="slim" tone="critical" onClick={() => removeVariant(id)}>
                Remove
              </Button>
            </InlineStack>
          ))
        )}
      </BlockStack>
    </BlockStack>
  );
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function ensureId(id: string): string {
  const s = String(id || "").trim();
  if (s) return s;
  return `cmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* =============================================================================
 * Loader / Action
 * ========================================================================== */

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const query = `#graphql
    query CampaignsConfig {
      shop {
        id
        metafield(namespace: "${META_NAMESPACE}", key: "${META_KEY}") {
          id
          value
        }
      }
    }
  `;

  const res = await adminGraphql(admin, query);
  const json = await res.json();

  const shopId = json?.data?.shop?.id as string | undefined;
  if (!shopId) {
    return new Response("Shop not found", { status: 500 });
  }

  const mf = json?.data?.shop?.metafield;
  const campaigns = safeJsonParse<Campaign[]>(mf?.value, []);

  const data: LoaderData = {
    campaigns,
    metafieldId: mf?.id ?? null,
    shopId,
  };

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const form = await request.formData();
  const jsonText = String(form.get("campaignsJson") ?? "").trim();
  if (!jsonText) {
    const out: ActionData = { ok: false, error: "campaignsJson is empty" };
    return new Response(JSON.stringify(out), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let campaigns: Campaign[];
  try {
    campaigns = JSON.parse(jsonText) as Campaign[];
    if (!Array.isArray(campaigns)) throw new Error("Not an array");
  } catch {
    const out: ActionData = { ok: false, error: "Invalid JSON payload" };
    return new Response(JSON.stringify(out), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // minimal sanitation
  const sanitized: Campaign[] = campaigns.map((c) => {
    const base: CampaignBase = {
      id: ensureId(c.id),
      type: c.type,
      label: String(c.label ?? "").trim(),
      priority: toNumber((c as any).priority, 0),
      stackable: Boolean((c as any).stackable),
    };

    if (c.type === "BuyXGetOneFree") {
      return {
        ...base,
        type: "BuyXGetOneFree",
        buyQuantity: toNumber((c as any).buyQuantity, 2),
        eligibleVariantIds: (c as any).eligibleVariantIds?.map(toGidVariant).filter(Boolean) ?? [],
      };
    }

    if (c.type === "BuyXGetZFree") {
      return {
        ...base,
        type: "BuyXGetZFree",
        buyQuantity: toNumber((c as any).buyQuantity, 2),
        triggerVariantIds: (c as any).triggerVariantIds?.map(toGidVariant).filter(Boolean) ?? [],
        freeVariantId: toGidVariant((c as any).freeVariantId ?? ""),
      };
    }

    if (c.type === "BuyXGetZChoice") {
      return {
        ...base,
        type: "BuyXGetZChoice",
        buyQuantity: toNumber((c as any).buyQuantity, 3),
        triggerVariantIds: (c as any).triggerVariantIds?.map(toGidVariant).filter(Boolean) ?? [],
        choiceVariantIds: (c as any).choiceVariantIds?.map(toGidVariant).filter(Boolean) ?? [],
      };
    }

    if (c.type === "CartThresholdDiscount") {
      const dtype = (c as any).discount?.type === "fixed" ? "fixed" : "percentage";
      return {
        ...base,
        type: "CartThresholdDiscount",
        thresholdAmount: toNumber((c as any).thresholdAmount, 100),
        discount: {
          type: dtype,
          value: toNumber((c as any).discount?.value, 10),
        },
      };
    }

    // CartThresholdFreeChoice
    return {
      ...base,
      type: "CartThresholdFreeChoice",
      thresholdAmount: toNumber((c as any).thresholdAmount, 150),
      choiceVariantIds: (c as any).choiceVariantIds?.map(toGidVariant).filter(Boolean) ?? [],
    };
  });

  // fetch shop id for ownerId
  const shopRes = await adminGraphql(
    admin,
    `#graphql
      query ShopId {
        shop { id }
      }
    `,
  );
  const shopJson = await shopRes.json();
  const shopId = shopJson?.data?.shop?.id as string | undefined;
  if (!shopId) {
    const out: ActionData = { ok: false, error: "Shop ID not found" };
    return new Response(JSON.stringify(out), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const mutation = `#graphql
    mutation SaveCampaigns($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    metafields: [
      {
        ownerId: shopId,
        namespace: META_NAMESPACE,
        key: META_KEY,
        type: META_TYPE,
        value: JSON.stringify(sanitized),
      },
    ],
  };

  const saveRes = await adminGraphql(admin, mutation, { variables });
  const saveJson = await saveRes.json();

  const errs = saveJson?.data?.metafieldsSet?.userErrors ?? [];
  if (errs.length) {
    const out: ActionData = { ok: false, error: errs.map((e: any) => e.message).join("; ") };
    return new Response(JSON.stringify(out), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const out: ActionData = { ok: true };
  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/* =============================================================================
 * UI helpers
 * ========================================================================== */

const CAMPAIGN_TYPE_OPTIONS: { label: string; value: CampaignType }[] = [
  { label: "Buy X get 1 free", value: "BuyXGetOneFree" },
  { label: "Buy X get Z free", value: "BuyXGetZFree" },
  { label: "Buy X choose a free gift", value: "BuyXGetZChoice" },
  { label: "Threshold discount", value: "CartThresholdDiscount" },
  { label: "Threshold free choice", value: "CartThresholdFreeChoice" },
];

function typeLabel(t: CampaignType): string {
  return CAMPAIGN_TYPE_OPTIONS.find((x) => x.value === t)?.label ?? t;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/* =============================================================================
 * Component
 * ========================================================================== */

export default function CampaignsPage() {
  const { campaigns: initialCampaigns } = useLoaderData() as LoaderData;
  const actionData = useActionData() as ActionData | undefined;
  const nav = useNavigation();

  const [campaigns, setCampaigns] = React.useState<Campaign[]>(() => clone(initialCampaigns));

  // new campaign form
  const [selectedType, setSelectedType] = React.useState<CampaignType>("BuyXGetOneFree");

  // track dirty
  const isSaving = nav.state !== "idle";

  function updateCampaign(index: number, next: Campaign) {
    setCampaigns((prev) => {
      const copy = [...prev];
      copy[index] = next;
      return copy;
    });
  }

  function removeCampaign(index: number) {
    setCampaigns((prev) => prev.filter((_, i) => i !== index));
  }

  function addCampaign() {
    const base: CampaignBase = {
      id: ensureId(""),
      type: selectedType,
      label: "",
      priority: 0,
      stackable: true,
    };

    let next: Campaign;

    if (selectedType === "BuyXGetOneFree") {
      next = { ...base, type: "BuyXGetOneFree", buyQuantity: 2, eligibleVariantIds: [] };
    } else if (selectedType === "BuyXGetZFree") {
      next = {
        ...base,
        type: "BuyXGetZFree",
        buyQuantity: 2,
        triggerVariantIds: [],
        freeVariantId: "",
      };
    } else if (selectedType === "BuyXGetZChoice") {
      next = {
        ...base,
        type: "BuyXGetZChoice",
        buyQuantity: 3,
        triggerVariantIds: [],
        choiceVariantIds: [],
      };
    } else if (selectedType === "CartThresholdDiscount") {
      next = {
        ...base,
        type: "CartThresholdDiscount",
        thresholdAmount: 100,
        discount: { type: "percentage", value: 10 },
      };
    } else {
      next = {
        ...base,
        type: "CartThresholdFreeChoice",
        thresholdAmount: 150,
        choiceVariantIds: [],
      };
    }

    setCampaigns((prev) => [...prev, next]);
  }

  // ---- render editors per type
  function renderTypeFields(c: Campaign, idx: number) {
    if (c.type === "BuyXGetOneFree") {
      return (
        <BlockStack gap="300">
          <TextField
            label="Buy quantity (X)"
            type="number"
            value={String(c.buyQuantity)}
            onChange={(value: string) =>
              updateCampaign(idx, { ...c, buyQuantity: toNumber(value, 0) })
            }
            autoComplete="off"
          />
          <TextField
            label="Eligible variant IDs (one per line) — cheapest units become free"
            value={variantIdsToText(c.eligibleVariantIds)}
            onChange={() => undefined}
            helpText="Use search below to pick variants."
            disabled
          />
          <VariantPicker
            label="Search eligible variants"
            selectedIds={c.eligibleVariantIds}
            onChange={(next) => updateCampaign(idx, { ...c, eligibleVariantIds: next })}
          />
        </BlockStack>
      );
    }

    if (c.type === "BuyXGetZFree") {
      return (
        <BlockStack gap="300">
          <TextField
            label="Buy quantity (X)"
            type="number"
            value={String(c.buyQuantity)}
            onChange={(value: string) =>
              updateCampaign(idx, { ...c, buyQuantity: toNumber(value, 0) })
            }
            autoComplete="off"
          />
          <TextField
            label="Trigger variant IDs (one per line)"
            value={variantIdsToText(c.triggerVariantIds)}
            onChange={() => undefined}
            disabled
          />
          <VariantPicker
            label="Search trigger variants"
            selectedIds={c.triggerVariantIds}
            onChange={(next) => updateCampaign(idx, { ...c, triggerVariantIds: next })}
          />
          <TextField
            label="Free variant ID (Z)"
            value={c.freeVariantId || ""}
            onChange={() => undefined}
            disabled
          />
          <VariantPicker
            label="Search free variant"
            selectedIds={c.freeVariantId ? [c.freeVariantId] : []}
            onChange={(next) => updateCampaign(idx, { ...c, freeVariantId: next[0] || "" })}
            single
          />
        </BlockStack>
      );
    }

    if (c.type === "BuyXGetZChoice") {
      return (
        <BlockStack gap="300">
          <TextField
            label="Buy quantity (X)"
            type="number"
            value={String(c.buyQuantity)}
            onChange={(value: string) =>
              updateCampaign(idx, { ...c, buyQuantity: toNumber(value, 0) })
            }
            autoComplete="off"
          />
          <TextField
            label="Trigger variant IDs (one per line)"
            value={variantIdsToText(c.triggerVariantIds)}
            onChange={() => undefined}
            disabled
          />
          <VariantPicker
            label="Search trigger variants"
            selectedIds={c.triggerVariantIds}
            onChange={(next) => updateCampaign(idx, { ...c, triggerVariantIds: next })}
          />
          <TextField
            label="Choice variant IDs (gifts) — one per line"
            value={variantIdsToText(c.choiceVariantIds)}
            onChange={() => undefined}
            disabled
          />
          <VariantPicker
            label="Search gift variants"
            selectedIds={c.choiceVariantIds}
            onChange={(next) => updateCampaign(idx, { ...c, choiceVariantIds: next })}
          />
        </BlockStack>
      );
    }

    if (c.type === "CartThresholdDiscount") {
      return (
        <BlockStack gap="300">
          <TextField
            label="Threshold amount"
            type="number"
            value={String(c.thresholdAmount)}
            onChange={(value: string) =>
              updateCampaign(idx, { ...c, thresholdAmount: toNumber(value, 0) })
            }
            autoComplete="off"
          />
          <Select
            label="Discount type"
            options={[
              { label: "Percentage", value: "percentage" },
              { label: "Fixed amount", value: "fixed" },
            ]}
            value={c.discount.type}
            onChange={(value: string) =>
              updateCampaign(idx, { ...c, discount: { ...c.discount, type: value as "percentage" | "fixed" } })
            }
          />
          <TextField
            label={c.discount.type === "percentage" ? "Percentage value (e.g. 10)" : "Fixed value (e.g. 5.00)"}
            type="number"
            value={String(c.discount.value)}
            onChange={(value: string) =>
              updateCampaign(idx, { ...c, discount: { ...c.discount, value: toNumber(value, 0) } })
            }
            autoComplete="off"
          />
        </BlockStack>
      );
    }

    // CartThresholdFreeChoice
    return (
      <BlockStack gap="300">
        <TextField
          label="Threshold amount"
          type="number"
          value={String(c.thresholdAmount)}
          onChange={(value: string) =>
            updateCampaign(idx, { ...c, thresholdAmount: toNumber(value, 0) })
          }
          autoComplete="off"
        />
        <TextField
          label="Choice variant IDs (gifts) — one per line"
          value={variantIdsToText(c.choiceVariantIds)}
          onChange={() => undefined}
          disabled
        />
        <VariantPicker
          label="Search gift variants"
          selectedIds={c.choiceVariantIds}
          onChange={(next) => updateCampaign(idx, { ...c, choiceVariantIds: next })}
        />
      </BlockStack>
    );
  }

  // We need React import for hooks in this file (some templates don't auto-inject)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars


  return (
    <Page
      title="Campaigns"
      subtitle="Configure automatic campaigns used by pricingEngine (stored in mk.campaigns metafield)"
      primaryAction={undefined}
    >
      <Layout>
        <Layout.Section>
          {actionData && !actionData.ok ? (
            <Banner tone="critical" title="Save failed">
              <p>{actionData.error}</p>
            </Banner>
          ) : null}

          {actionData && actionData.ok ? (
            <Banner tone="success" title="Saved">
              <p>Campaigns config saved successfully.</p>
            </Banner>
          ) : null}

          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Add campaign
              </Text>

              <InlineStack gap="300" align="start" blockAlign="center">
                <div style={{ minWidth: 320 }}>
                  <Select
                    label="Type"
                    options={CAMPAIGN_TYPE_OPTIONS.map((o) => ({
                      label: o.label,
                      value: o.value,
                    }))}
                    value={selectedType}
                    onChange={(value: string) => setSelectedType(value as CampaignType)}
                  />
                </div>

                <Button onClick={addCampaign} variant="primary">
                  Add
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <div style={{ height: 16 }} />

          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Campaigns list
              </Text>

              {campaigns.length === 0 ? (
                <Text as="p" tone="subdued">
                  No campaigns yet.
                </Text>
              ) : (
                <BlockStack gap="500">
                  {campaigns.map((c, idx) => (
                    <Card key={c.id} padding="400">
                      <BlockStack gap="400">
                        <InlineStack gap="300" align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingSm">
                            {typeLabel(c.type)}
                          </Text>
                          <Button tone="critical" onClick={() => removeCampaign(idx)}>
                            Delete
                          </Button>
                        </InlineStack>

                        <Divider />

                        <BlockStack gap="300">
                          <TextField
                            label="ID"
                            value={c.id}
                            onChange={(value: string) =>
                              updateCampaign(idx, { ...(c as any), id: String(value || "").trim() })
                            }
                            helpText="Уникальный ID кампании"
                            autoComplete="off"
                          />

                          <TextField
                            label="Label"
                            value={c.label}
                            onChange={(value: string) =>
                              updateCampaign(idx, { ...(c as any), label: String(value || "") })
                            }
                            autoComplete="off"
                          />

                          <InlineStack gap="300">
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="Priority"
                                type="number"
                                value={String(c.priority)}
                                onChange={(value: string) =>
                                  updateCampaign(idx, { ...(c as any), priority: toNumber(value, 0) })
                                }
                                autoComplete="off"
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <Select
                                label="Stackable"
                                options={[
                                  { label: "Yes", value: "true" },
                                  { label: "No", value: "false" },
                                ]}
                                value={c.stackable ? "true" : "false"}
                                onChange={(value: string) =>
                                  updateCampaign(idx, { ...(c as any), stackable: value === "true" })
                                }
                              />
                            </div>
                          </InlineStack>

                          <Divider />

                          {renderTypeFields(c, idx)}
                        </BlockStack>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              )}

              <Divider />

              <Form method="post">
                <input type="hidden" name="campaignsJson" value={JSON.stringify(campaigns)} />
                <InlineStack gap="300" align="end">
                  <Button submit variant="primary" loading={isSaving}>
                    Save campaigns
                  </Button>
                </InlineStack>
              </Form>

              <Text as="p" tone="subdued">
                Эти кампании используются твоим backend pricingEngine. После сохранения они лежат в shop metafield{" "}
                <code>mk.campaigns</code>.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
