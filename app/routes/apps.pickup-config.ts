import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  adminGraphql,
  getShippingZones,
  type ProviderKey,
  type ShippingZone,
} from "../shipping.server";

type ProviderMeta = Record<ProviderKey, { title: string; logo?: string }>;
type ProviderMapping = Record<string, ProviderKey | null>;

type ShippingConfig = {
  providerMeta: ProviderMeta;
  providerMapping: ProviderMapping;
  countryFlags: Record<string, string>;
};

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

const METAOBJECT_TYPE = "pickup_config";
const METAOBJECT_HANDLE = "default";

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
  const jsonRes = await res.json();

  const fields = jsonRes.data?.metaobjectByHandle?.fields ?? [];
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

function formatPrice(
  amount: string | null,
  currency: string | null,
): string | null {
  if (!amount) return null;
  if (!currency) return amount;
  return `${amount} ${currency}`;
}

function mapZonesToConfig(zones: ShippingZone[], config: ShippingConfig) {
  const countries = new Map<
    string,
    {
      code: string;
      label: string;
      flagUrl: string;
      enabled: boolean;
      providers: ProviderKey[];
      providerLabels?: Partial<Record<ProviderKey, string>>;
      pricesByProvider: Partial<Record<ProviderKey, string>>;
    }
  >();

  for (const zone of zones) {
    for (const country of zone.countries) {
      if (!countries.has(country.code)) {
        countries.set(country.code, {
          code: country.code,
          label: country.name || country.code,
          flagUrl: config.countryFlags?.[country.code] ?? "",
          enabled: true,
          providers: [],
          providerLabels: {},
          pricesByProvider: {},
        });
      }
    }

    for (const rate of zone.rates) {
      const providerKey = config.providerMapping?.[rate.id];
      if (!providerKey) continue;

      const price = formatPrice(rate.priceAmount, rate.currencyCode);
      for (const country of zone.countries) {
        const existing = countries.get(country.code);
        if (!existing) continue;

        if (!existing.providers.includes(providerKey)) {
          existing.providers.push(providerKey);
        }
        if (price) {
          existing.pricesByProvider[providerKey] = price;
        }
        existing.providerLabels = {
          ...existing.providerLabels,
          [providerKey]: rate.name,
        };
      }
    }
  }

  return {
    countries: Array.from(countries.values()),
    providerMeta: config.providerMeta,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await authenticate.public.appProxy(request);

  if (!ctx.session) {
    return json({
      config: { countries: [], providerMeta: DEFAULT_PROVIDER_META },
      warning:
        "App proxy session is unavailable. Open the app in Admin to refresh the session.",
    });
  }

  const config = await getConfig(ctx.admin);
  const zones = await getShippingZones(ctx.admin);
  const mappedConfig = mapZonesToConfig(zones, config);

  return json({ config: mappedConfig });
}
