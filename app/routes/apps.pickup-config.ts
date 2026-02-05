import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

type CountryCode = "EE" | "LV" | "LT" | "FI";
type ProviderKey = "smartposti";

type PickupConfig = {
  countries: CountryCode[];
  providersByCountry: Record<CountryCode, ProviderKey[]>;
  providerMeta: Record<ProviderKey, { title: string; logo: string }>;
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

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await authenticate.public.appProxy(request);

  // ✅ Если нет сессии/токена — Admin API недоступен
  if (!ctx.admin) {
    return json({
      config: DEFAULT_CONFIG,
      warning:
        "Admin API is unavailable for this app proxy request (no offline session). Open the app in Admin and reinstall/reset scopes if needed.",
    });
  }

  const query = `#graphql
  query {
    shop {
      metafield(namespace: "pickup", key: "config") { value type }
    }
  }`;

  const res = await ctx.admin.graphql(query);
  const gql = await res.json();
  const raw = gql.data?.shop?.metafield?.value;

  if (!raw) return json({ config: DEFAULT_CONFIG });

  try {
    const parsed = JSON.parse(raw);
    const config: PickupConfig = {
      countries: Array.isArray(parsed.countries) ? parsed.countries : DEFAULT_CONFIG.countries,
      providersByCountry: parsed.providersByCountry ?? DEFAULT_CONFIG.providersByCountry,
      providerMeta: parsed.providerMeta ?? DEFAULT_CONFIG.providerMeta,
    };
    return json({ config });
  } catch {
    return json({ config: DEFAULT_CONFIG, warning: "Bad JSON in metafield" });
  }
}
