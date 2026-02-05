import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";

type CountryCode = string;
type ProviderKey = "smartposti" | "flat_rate";

type CountryConfig = {
  code: CountryCode;
  label: string;
  flagUrl: string;
  enabled: boolean;
  providers: ProviderKey[];
  pricesByProvider: Partial<Record<ProviderKey, string>>;
};

type PickupConfig = {
  countries: CountryConfig[];
  providerMeta: Record<ProviderKey, { title: string; logo?: string }>;
};

const DEFAULT_CONFIG: PickupConfig = {
  countries: [
    {
      code: "EE",
      label: "Estonia",
      flagUrl: "https://flagcdn.com/w40/ee.png",
      enabled: true,
      providers: ["smartposti", "flat_rate"],
      pricesByProvider: { smartposti: "3.99", flat_rate: "4.99" },
    },
    {
      code: "LV",
      label: "Latvia",
      flagUrl: "https://flagcdn.com/w40/lv.png",
      enabled: true,
      providers: ["smartposti", "flat_rate"],
      pricesByProvider: { smartposti: "4.99", flat_rate: "5.99" },
    },
    {
      code: "LT",
      label: "Lithuania",
      flagUrl: "https://flagcdn.com/w40/lt.png",
      enabled: true,
      providers: ["smartposti", "flat_rate"],
      pricesByProvider: { smartposti: "4.99", flat_rate: "5.99" },
    },
    {
      code: "FI",
      label: "Finland",
      flagUrl: "https://flagcdn.com/w40/fi.png",
      enabled: true,
      providers: ["smartposti", "flat_rate"],
      pricesByProvider: { smartposti: "6.99", flat_rate: "7.99" },
    },
  ],
  providerMeta: {
    smartposti: {
      title: "Smartposti parcel lockers",
      logo: "https://production.parcely.app/images/itella.png",
    },
    flat_rate: {
      title: "Flat rate delivery",
    },
  },
};

async function getShopId(admin: any) {
  const query = `#graphql
  query {
    shop { id }
  }`;
  const res = await admin.graphql(query);
  const json = await res.json();
  return json.data.shop.id as string;
}

function normalizeConfig(raw: any): PickupConfig {
  if (!raw) return DEFAULT_CONFIG;

  if (Array.isArray(raw.countries) && raw.countries.length > 0) {
    if (typeof raw.countries[0] === "string") {
      const fallbackCountries = raw.countries.map((code: string) => {
        const match = DEFAULT_CONFIG.countries.find(
          (country) => country.code === code,
        );
        return (
          match ?? {
            code,
            label: code,
            flagUrl: "",
            enabled: true,
            providers: ["smartposti"],
            pricesByProvider: {},
          }
        );
      });
      return {
        countries: fallbackCountries,
        providerMeta: raw.providerMeta ?? DEFAULT_CONFIG.providerMeta,
      };
    }

    const normalizedCountries = raw.countries.map((country: any) => {
      const code = String(country.code ?? "").trim().toUpperCase();
      const match = DEFAULT_CONFIG.countries.find(
        (defaultCountry) => defaultCountry.code === code,
      );

      return {
        code,
        label: String(country.label ?? match?.label ?? code),
        flagUrl: String(country.flagUrl ?? match?.flagUrl ?? ""),
        enabled: Boolean(country.enabled ?? true),
        providers: Array.isArray(country.providers)
          ? country.providers
          : match?.providers ?? ["smartposti"],
        pricesByProvider: country.pricesByProvider ?? match?.pricesByProvider ?? {},
      } as CountryConfig;
    });

    return {
      countries: normalizedCountries.filter((country) => country.code),
      providerMeta: raw.providerMeta ?? DEFAULT_CONFIG.providerMeta,
    };
  }

  return DEFAULT_CONFIG;
}

async function getConfig(admin: any): Promise<PickupConfig> {
  const query = `#graphql
  query {
    shop {
      metafield(namespace: "pickup", key: "config") {
        value
        type
      }
    }
  }`;

  const res = await admin.graphql(query);
  const json = await res.json();

  const raw = json.data?.shop?.metafield?.value;
  if (!raw) return DEFAULT_CONFIG;

  try {
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(admin: any, config: PickupConfig) {
  const shopId = await getShopId(admin);

  const mutation = `#graphql
  mutation Save($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message }
    }
  }`;

  const variables = {
    metafields: [
      {
        ownerId: shopId,
        namespace: "pickup",
        key: "config",
        type: "json",
        value: JSON.stringify(config),
      },
    ],
  };

  const res = await admin.graphql(mutation, { variables });
  const json = await res.json();

  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    const msg = errors.map((e: any) => e.message).join(", ");
    throw new Error(msg);
  }
}

function parseCountryRows(form: FormData): CountryConfig[] {
  const count = Number(form.get("countryCount") ?? 0);
  const countries: CountryConfig[] = [];

  for (let i = 0; i < count; i += 1) {
    const code = String(form.get(`country_${i}_code`) ?? "")
      .trim()
      .toUpperCase();
    if (!code) continue;

    const remove = form.get(`country_${i}_remove`) === "on";
    if (remove) continue;

    const label = String(form.get(`country_${i}_label`) ?? code).trim();
    const flagUrl = String(form.get(`country_${i}_flag`) ?? "").trim();
    const enabled = form.get(`country_${i}_enabled`) === "on";
    const providers: ProviderKey[] = [];

    if (form.get(`country_${i}_provider_smartposti`) === "on") {
      providers.push("smartposti");
    }
    if (form.get(`country_${i}_provider_flat_rate`) === "on") {
      providers.push("flat_rate");
    }

    const smartpostiPrice = String(
      form.get(`country_${i}_price_smartposti`) ?? "",
    ).trim();
    const flatRatePrice = String(
      form.get(`country_${i}_price_flat_rate`) ?? "",
    ).trim();

    countries.push({
      code,
      label,
      flagUrl,
      enabled,
      providers,
      pricesByProvider: {
        smartposti: smartpostiPrice || undefined,
        flat_rate: flatRatePrice || undefined,
      },
    });
  }

  const newCode = String(form.get("new_country_code") ?? "")
    .trim()
    .toUpperCase();
  if (newCode) {
    const newLabel = String(form.get("new_country_label") ?? newCode).trim();
    const newFlagUrl = String(form.get("new_country_flag") ?? "").trim();
    const newEnabled = form.get("new_country_enabled") === "on";
    const newProviders: ProviderKey[] = [];

    if (form.get("new_country_provider_smartposti") === "on") {
      newProviders.push("smartposti");
    }
    if (form.get("new_country_provider_flat_rate") === "on") {
      newProviders.push("flat_rate");
    }

    const newSmartpostiPrice = String(
      form.get("new_country_price_smartposti") ?? "",
    ).trim();
    const newFlatRatePrice = String(
      form.get("new_country_price_flat_rate") ?? "",
    ).trim();

    if (!countries.find((country) => country.code === newCode)) {
      countries.push({
        code: newCode,
        label: newLabel,
        flagUrl: newFlagUrl,
        enabled: newEnabled,
        providers: newProviders,
        pricesByProvider: {
          smartposti: newSmartpostiPrice || undefined,
          flat_rate: newFlatRatePrice || undefined,
        },
      });
    }
  }

  return countries;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const config = await getConfig(admin);

  return Response.json({ config });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();

  const countries = parseCountryRows(form);

  const config: PickupConfig = {
    countries,
    providerMeta: DEFAULT_CONFIG.providerMeta,
  };

  await saveConfig(admin, config);
  return Response.json({ ok: true });
}

export default function PickupSettingsPage() {
  const data = useLoaderData() as { config: PickupConfig };
  const nav = useNavigation();
  const saving = nav.state !== "idle";

  const cfg = normalizeConfig(data.config);
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
          Manage countries, flags, providers and prices shown in the cart.
        </p>
      </div>

      <Form method="post">
        <input type="hidden" name="countryCount" value={cfg.countries.length} />

        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "110px 1.4fr 1.8fr 1.7fr 1fr 1fr 120px",
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
            <div>Enabled</div>
            <div>Country</div>
            <div>Flag URL</div>
            <div>Providers</div>
            <div>Smartposti price</div>
            <div>Flat rate price</div>
            <div>Remove</div>
          </div>

          {cfg.countries.map((country, index) => (
            <div
              key={country.code}
              style={{
                display: "grid",
                gridTemplateColumns: "110px 1.4fr 1.8fr 1.7fr 1fr 1fr 120px",
                gap: 14,
                padding: "16px 18px",
                borderTop: "1px solid rgba(0,0,0,.08)",
                alignItems: "center",
                fontSize: 13,
                background: index % 2 === 1 ? "rgba(0,0,0,.015)" : "white",
              }}
            >
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  name={`country_${index}_enabled`}
                  defaultChecked={country.enabled}
                />
                <span>Active</span>
              </label>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  name={`country_${index}_code`}
                  defaultValue={country.code}
                  style={{
                    width: 64,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,.12)",
                  }}
                />
                <input
                  type="text"
                  name={`country_${index}_label`}
                  defaultValue={country.label}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,.12)",
                  }}
                />
              </div>

              <input
                type="text"
                name={`country_${index}_flag`}
                defaultValue={country.flagUrl}
                placeholder="https://..."
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,.12)",
                }}
              />

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    name={`country_${index}_provider_smartposti`}
                    defaultChecked={country.providers.includes("smartposti")}
                  />
                  <span>Smartposti</span>
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    name={`country_${index}_provider_flat_rate`}
                    defaultChecked={country.providers.includes("flat_rate")}
                  />
                  <span>Flat rate</span>
                </label>
              </div>

              <input
                type="text"
                name={`country_${index}_price_smartposti`}
                defaultValue={country.pricesByProvider.smartposti ?? ""}
                placeholder="e.g. 3.99"
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,.12)",
                }}
              />
              <input
                type="text"
                name={`country_${index}_price_flat_rate`}
                defaultValue={country.pricesByProvider.flat_rate ?? ""}
                placeholder="e.g. 4.99"
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,.12)",
                }}
              />

              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" name={`country_${index}_remove`} />
                <span>Remove</span>
              </label>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 20,
            border: "1px dashed rgba(0,0,0,.2)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <h2 style={{ fontSize: 16, margin: 0 }}>Add new country</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 1.4fr 1.6fr 1fr 1fr",
              gap: 12,
              marginTop: 12,
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="new_country_enabled" defaultChecked />
              <span>Active</span>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                name="new_country_code"
                placeholder="Code"
                style={{
                  width: 70,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,.12)",
                }}
              />
              <input
                type="text"
                name="new_country_label"
                placeholder="Country name"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,.12)",
                }}
              />
            </div>
            <input
              type="text"
              name="new_country_flag"
              placeholder="Flag URL"
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,.12)",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  name="new_country_provider_smartposti"
                />
                <span>Smartposti</span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" name="new_country_provider_flat_rate" />
                <span>Flat rate</span>
              </label>
            </div>
            <input
              type="text"
              name="new_country_price_smartposti"
              placeholder="Smartposti price"
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,.12)",
              }}
            />
            <input
              type="text"
              name="new_country_price_flat_rate"
              placeholder="Flat rate price"
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,.12)",
              }}
            />
          </div>
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
            Changes apply to cart immediately via App Proxy.
          </span>
        </div>
      </Form>
    </div>
  );
}
