import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

type CountryCode = string;
type ProviderKey = "smartposti" | "flat_rate";

type CountryConfig = {
  code: CountryCode;
  label: string;
  flagUrl: string;
  enabled: boolean;
  providers: ProviderKey[];
  providerLabels?: Partial<Record<ProviderKey, string>>;
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
      providerLabels: { flat_rate: "Flat rate delivery" },
      pricesByProvider: { smartposti: "3.99", flat_rate: "4.99" },
    },
    {
      code: "LV",
      label: "Latvia",
      flagUrl: "https://flagcdn.com/w40/lv.png",
      enabled: true,
      providers: ["smartposti", "flat_rate"],
      providerLabels: { flat_rate: "Flat rate delivery" },
      pricesByProvider: { smartposti: "4.99", flat_rate: "5.99" },
    },
    {
      code: "LT",
      label: "Lithuania",
      flagUrl: "https://flagcdn.com/w40/lt.png",
      enabled: true,
      providers: ["smartposti", "flat_rate"],
      providerLabels: { flat_rate: "Flat rate delivery" },
      pricesByProvider: { smartposti: "4.99", flat_rate: "5.99" },
    },
    {
      code: "FI",
      label: "Finland",
      flagUrl: "https://flagcdn.com/w40/fi.png",
      enabled: true,
      providers: ["smartposti", "flat_rate"],
      providerLabels: { flat_rate: "Flat rate delivery" },
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

const METAOBJECT_TYPE = "pickup_config";
const METAOBJECT_HANDLE = "default";

async function adminGraphql(admin: any, query: string, options?: { variables?: any }) {
  if (typeof admin?.graphql === "function") {
    return admin.graphql(query, options);
  }
  if (admin?.graphql?.query) {
    return admin.graphql.query({ data: query, variables: options?.variables });
  }
  if (admin?.graphql?.request) {
    return admin.graphql.request(query, { variables: options?.variables });
  }
  throw new Error("Admin GraphQL client is unavailable");
}

function json(data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
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
            providerLabels: {},
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
        providerLabels: country.providerLabels ?? match?.providerLabels ?? {},
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

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await authenticate.public.appProxy(request);

  if (!ctx.admin) {
    return json({
      config: { countries: [], providerMeta: DEFAULT_CONFIG.providerMeta },
      warning:
        "Admin API is unavailable for this app proxy request (no offline session). Open the app in Admin and reinstall/reset scopes if needed.",
    });
  }

  const query = `#graphql
  query Config($handle: MetaobjectHandleInput!) {
    metaobjectByHandle(handle: $handle) {
      fields { key value }
    }
  }`;

  const res = await adminGraphql(ctx.admin, query, {
    variables: { handle: { type: METAOBJECT_TYPE, handle: METAOBJECT_HANDLE } },
  });
  const gql = await res.json();
  const fields = gql.data?.metaobjectByHandle?.fields ?? [];
  const configField = fields.find((field: any) => field.key === "config");
  const raw = configField?.value;

  if (!raw) return json({ config: DEFAULT_CONFIG });

  try {
    const parsed = JSON.parse(raw);
    const config = normalizeConfig(parsed);
    return json({ config });
  } catch {
    return json({ config: DEFAULT_CONFIG, warning: "Bad JSON in metaobject" });
  }
}
