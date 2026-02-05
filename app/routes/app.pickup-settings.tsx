import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";

type CountryCode = "EE" | "LV" | "LT" | "FI";
type ProviderKey = "smartposti";

type PickupConfig = {
  countries: CountryCode[];
  providersByCountry: Record<CountryCode, ProviderKey[]>;
  providerMeta: Record<
    ProviderKey,
    { title: string; logo: string }
  >;
};

const DEFAULT_CONFIG: PickupConfig = {
  countries: ["EE", "LV", "LT", "FI"],
  providersByCountry: {
    EE: ["smartposti"],
    LV: ["smartposti"],
    LT: ["smartposti"],
    FI: ["smartposti"],
  },
  providerMeta: {
    smartposti: {
      title: "Smartposti parcel lockers",
      logo: "https://production.parcely.app/images/itella.png",
    },
  },
};

const ALL_COUNTRIES: { code: CountryCode; label: string }[] = [
  { code: "EE", label: "Estonia" },
  { code: "LV", label: "Latvia" },
  { code: "LT", label: "Lithuania" },
  { code: "FI", label: "Finland" },
];

async function getShopId(admin: any) {
  const query = `#graphql
  query {
    shop { id }
  }`;
  const res = await admin.graphql(query);
  const json = await res.json();
  return json.data.shop.id as string;
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
    // легкая нормализация / fallback
    return {
      countries: Array.isArray(parsed.countries) ? parsed.countries : DEFAULT_CONFIG.countries,
      providersByCountry: parsed.providersByCountry ?? DEFAULT_CONFIG.providersByCountry,
      providerMeta: parsed.providerMeta ?? DEFAULT_CONFIG.providerMeta,
    };
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

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const config = await getConfig(admin);

  return Response.json({ config });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const form = await request.formData();

  const enabledCountries = ALL_COUNTRIES
    .map((c) => c.code)
    .filter((code) => form.get(`country_${code}`) === "on") as CountryCode[];

  const providersByCountry = {} as PickupConfig["providersByCountry"];
  for (const { code } of ALL_COUNTRIES) {
    const enabledSmartposti = form.get(`provider_${code}_smartposti`) === "on";
    providersByCountry[code] = enabledSmartposti ? ["smartposti"] : [];
  }

  const config: PickupConfig = {
    countries: enabledCountries,
    providersByCountry,
    providerMeta: DEFAULT_CONFIG.providerMeta, // сейчас только smartposti
  };

  await saveConfig(admin, config);
  return Response.json({ ok: true });
}

export default function PickupSettingsPage() {
  const data = useLoaderData() as { config: PickupConfig };
  const nav = useNavigation();
  const saving = nav.state !== "idle";

  const cfg = data.config;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        Pickup settings
      </h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Enable countries and pickup providers shown in cart.
      </p>

      <Form method="post">
        <div
          style={{
            border: "1px solid rgba(0,0,0,.12)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "180px 1fr",
              gap: 0,
              background: "rgba(0,0,0,.03)",
              padding: "12px 16px",
              fontWeight: 600,
            }}
          >
            <div>Country</div>
            <div>Providers</div>
          </div>

          {ALL_COUNTRIES.map(({ code, label }) => {
            const countryEnabled = cfg.countries.includes(code);
            const smartpostiEnabled =
              (cfg.providersByCountry?.[code] ?? []).includes("smartposti");

            return (
              <div
                key={code}
                style={{
                  display: "grid",
                  gridTemplateColumns: "180px 1fr",
                  gap: 0,
                  padding: "14px 16px",
                  borderTop: "1px solid rgba(0,0,0,.08)",
                  alignItems: "center",
                }}
              >
                <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    name={`country_${code}`}
                    defaultChecked={countryEnabled}
                  />
                  <span>
                    <b style={{ marginRight: 6 }}>{code}</b> {label}
                  </span>
                </label>

                <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    name={`provider_${code}_smartposti`}
                    defaultChecked={smartpostiEnabled}
                  />
                  <img
                    src={cfg.providerMeta.smartposti.logo}
                    alt="Smartposti"
                    style={{ width: 80, height: "auto" }}
                  />
                  <span>{cfg.providerMeta.smartposti.title}</span>
                </label>
              </div>
            );
          })}
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
