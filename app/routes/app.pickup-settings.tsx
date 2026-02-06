import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import {
  adminGraphql,
  getShippingZones,
  type ProviderKey,
  type ShippingZone,
} from "../shipping.server";

type ProviderMeta = Record<ProviderKey, { title: string; logo?: string }>;
type ProviderMapping = Record<string, ProviderKey | null>;

const DEFAULT_PROVIDER_META: ProviderMeta = {
  smartposti: {
    title: "Smartposti parcel lockers",
    logo: "https://production.parcely.app/images/itella.png",
  },
  flat_rate: {
    title: "Flat rate delivery",
  },
  wolt: {
    title: "Wolt delivery",
  },
};

type ShippingConfig = {
  providerMeta: ProviderMeta;
  providerMapping: ProviderMapping;
  countryFlags: Record<string, string>;
};

const METAOBJECT_TYPE = "pickup_config";
const METAOBJECT_HANDLE = "default";

async function ensureMetaobjectDefinition(admin: any) {
  const query = `#graphql
  query Definition($type: String!) {
    metaobjectDefinitionByType(type: $type) { id type }
  }`;

  const res = await adminGraphql(admin, query, {
    variables: { type: METAOBJECT_TYPE },
  });
  const json = await res.json();
  if (json.data?.metaobjectDefinitionByType?.id) return;

  const mutation = `#graphql
  mutation CreateDefinition($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message }
    }
  }`;

  const variables = {
    definition: {
      type: METAOBJECT_TYPE,
      name: "Pickup config",
      access: { storefront: "PUBLIC_READ" },
      fieldDefinitions: [
        {
          key: "config",
          name: "Config",
          type: "json",
        },
      ],
    },
  };

  const createRes = await adminGraphql(admin, mutation, { variables });
  const createJson = await createRes.json();
  const errors = createJson.data?.metaobjectDefinitionCreate?.userErrors ?? [];
  if (errors.length) {
    const msg = errors.map((e: any) => e.message).join(", ");
    throw new Error(msg);
  }
}

async function getConfig(admin: any): Promise<ShippingConfig> {
  const query = `#graphql
  query Config($handle: MetaobjectHandleInput!) {
    metaobjectByHandle(handle: $handle) {
      fields { key value }
    }
  }`;

  const res = await adminGraphql(admin, query, {
    variables: { handle: { type: METAOBJECT_TYPE, handle: METAOBJECT_HANDLE } },
  });
  const json = await res.json();

  const fields = json.data?.metaobjectByHandle?.fields ?? [];
  const configField = fields.find((field: any) => field.key === "config");
  const raw = configField?.value;
  if (!raw) {
    return {
      providerMeta: DEFAULT_PROVIDER_META,
      providerMapping: {},
      countryFlags: {},
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      providerMeta: parsed.providerMeta ?? DEFAULT_PROVIDER_META,
      providerMapping: parsed.providerMapping ?? {},
      countryFlags: parsed.countryFlags ?? {},
    };
  } catch {
    return {
      providerMeta: DEFAULT_PROVIDER_META,
      providerMapping: {},
      countryFlags: {},
    };
  }
}

async function saveConfig(admin: any, config: ShippingConfig) {
  await ensureMetaobjectDefinition(admin);

  const mutation = `#graphql
  mutation Upsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message }
    }
  }`;

  const variables = {
    handle: { type: METAOBJECT_TYPE, handle: METAOBJECT_HANDLE },
    metaobject: {
      fields: [
        {
          key: "config",
          value: JSON.stringify(config),
        },
      ],
    },
  };

  const res = await adminGraphql(admin, mutation, { variables });
  const json = await res.json();

  const errors = json.data?.metaobjectUpsert?.userErrors ?? [];
  if (errors.length) {
    const msg = errors.map((e: any) => e.message).join(", ");
    throw new Error(msg);
  }
}

function parseProviderMapping(form: FormData) {
  const count = Number(form.get("rateCount") ?? 0);
  const mapping: ProviderMapping = {};

  for (let i = 0; i < count; i += 1) {
    const id = String(form.get(`rate_${i}_id`) ?? "").trim();
    if (!id) continue;
    const selected = String(form.get(`rate_${i}_provider`) ?? "").trim();
    mapping[id] =
      selected === "smartposti" || selected === "flat_rate" || selected === "wolt"
        ? selected
        : null;
  }

  return mapping;
}

function parseCountryFlags(form: FormData) {
  const count = Number(form.get("countryCount") ?? 0);
  const flags: Record<string, string> = {};

  for (let i = 0; i < count; i += 1) {
    const code = String(form.get(`country_${i}_code`) ?? "").trim();
    if (!code) continue;
    const flagUrl = String(form.get(`country_${i}_flag`) ?? "").trim();
    if (flagUrl) {
      flags[code] = flagUrl;
    }
  }

  return flags;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  await ensureMetaobjectDefinition(admin);
  const config = await getConfig(admin);
  const zones = await getShippingZones(admin);

  return Response.json({ config, zones });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();

  const providerMapping = parseProviderMapping(form);
  const countryFlags = parseCountryFlags(form);

  const config: ShippingConfig = {
    providerMeta: DEFAULT_PROVIDER_META,
    providerMapping,
    countryFlags,
  };

  await saveConfig(admin, config);
  return Response.json({ ok: true });
}

export default function PickupSettingsPage() {
  const data = useLoaderData() as { config: ShippingConfig; zones: ShippingZone[] };
  const nav = useNavigation();
  const saving = nav.state !== "idle";

  const cfg = data.config;
  const zones = data.zones ?? [];
  const rates = zones.flatMap((zone) =>
    zone.rates.map((rate) => ({ ...rate, zone })),
  );
  const countries = zones
    .flatMap((zone) => zone.countries)
    .reduce((acc, country) => {
      if (!acc.some((item) => item.code === country.code)) {
        acc.push(country);
      }
      return acc;
    }, [] as ShippingZone["countries"])
    .sort((a, b) => a.code.localeCompare(b.code));
  const cardStyle = {
    border: "1px solid rgba(0,0,0,.08)",
    borderRadius: 16,
    background: "white",
    padding: 20,
    boxShadow: "0 10px 20px rgba(0,0,0,.04)",
  } as const;

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>
          Pickup & delivery settings
        </h1>
        <p style={{ marginTop: 0, color: "#6b7280" }}>
          Assign your Shopify shipping rates to app delivery providers.
        </p>
      </div>

      <Form method="post">
        <input type="hidden" name="rateCount" value={rates.length} />
        <input type="hidden" name="countryCount" value={countries.length} />

        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>
            Country flags
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {countries.map((country, index) => (
              <div
                key={country.code}
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 1fr",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {country.code}
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {country.name}
                  </div>
                </div>
                <div>
                  <input
                    type="hidden"
                    name={`country_${index}_code`}
                    value={country.code}
                  />
                  <input
                    type="url"
                    name={`country_${index}_flag`}
                    placeholder="https://flagcdn.com/w40/ee.png"
                    defaultValue={cfg.countryFlags?.[country.code] ?? ""}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(0,0,0,.12)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2.2fr 1.4fr 1fr 1fr 1fr",
              gap: 0,
              background: "rgba(0,0,0,.03)",
              padding: "14px 18px",
              fontWeight: 600,
              fontSize: 12,
              color: "#4b5563",
              textTransform: "uppercase",
              letterSpacing: ".04em",
            }}
          >
            <div>Shipping rate</div>
            <div>Zone / Countries</div>
            <div>Price</div>
            <div>Currency</div>
            <div>Assign provider</div>
          </div>

          {rates.map((rate, index) => (
            <div
              key={rate.id}
              style={{
                display: "grid",
                gridTemplateColumns: "2.2fr 1.4fr 1fr 1fr 1fr",
                gap: 14,
                padding: "16px 18px",
                borderTop: "1px solid rgba(0,0,0,.08)",
                alignItems: "center",
                fontSize: 13,
                background: index % 2 === 1 ? "rgba(0,0,0,.015)" : "white",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontWeight: 600 }}>{rate.name}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{rate.id}</div>
                <input type="hidden" name={`rate_${index}_id`} value={rate.id} />
              </div>

              <div style={{ fontSize: 13, color: "#374151" }}>
                <div style={{ fontWeight: 600 }}>{rate.zone.name}</div>
                <div style={{ opacity: 0.7 }}>
                  {rate.zone.countries.map((country) => country.code).join(", ")}
                </div>
              </div>

              <div>{rate.priceAmount ?? "—"}</div>
              <div>{rate.currencyCode ?? "—"}</div>

              <select
                name={`rate_${index}_provider`}
                defaultValue={cfg.providerMapping?.[rate.id] ?? ""}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,.12)",
                  background: "white",
                }}
              >
                <option value="">Not mapped</option>
                <option value="smartposti">Smartposti</option>
                <option value="flat_rate">Flat rate</option>
                <option value="wolt">Wolt</option>
              </select>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
          <button
            type="submit"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,.14)",
              background: saving ? "rgba(0,0,0,.06)" : "white",
              cursor: saving ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>

          <span style={{ alignSelf: "center", opacity: 0.7 }}>
            Cart block loads settings via App Proxy (/apps/pickup-config).
          </span>
        </div>
      </Form>
    </div>
  );
}
