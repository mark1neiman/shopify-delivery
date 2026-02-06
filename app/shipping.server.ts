export type ProviderKey = "smartposti" | "flat_rate" | "wolt";

export type ShippingCountry = {
  code: string;
  name: string;
};

export type ShippingRate = {
  id: string;
  name: string;
  priceAmount: string | null;
  currencyCode: string | null;
};

export type ShippingZone = {
  id: string;
  name: string;
  countries: ShippingCountry[];
  rates: ShippingRate[];
};

// ------------------------------
// Admin GraphQL client typing
// ------------------------------

type GraphqlFnResponse = {
  json: () => Promise<any>;
};

type GraphqlFn = (query: string, options?: { variables?: any }) => Promise<GraphqlFnResponse>;

type GraphqlClientObject = {
  query?: (args: { data: string; variables?: any }) => Promise<GraphqlFnResponse>;
  request?: (query: string, options?: { variables?: any }) => Promise<GraphqlFnResponse>;
};

type GraphQLClient = {
  graphql?: GraphqlFn | GraphqlClientObject;
};

export async function adminGraphql(
  admin: GraphQLClient,
  query: string,
  options?: { variables?: any },
): Promise<GraphqlFnResponse> {
  const gql = admin?.graphql;

  if (typeof gql === "function") return gql(query, options);

  if (gql && typeof gql === "object" && typeof gql.query === "function") {
    return gql.query({ data: query, variables: options?.variables });
  }

  if (gql && typeof gql === "object" && typeof gql.request === "function") {
    return gql.request(query, { variables: options?.variables });
  }

  throw new Error("Admin GraphQL client is unavailable");
}

// ------------------------------
// Helpers
// ------------------------------

function getEdges<T>(connection?: { edges?: { node: T; cursor?: string }[] } | null): T[] {
  return connection?.edges?.map((edge) => edge.node) ?? [];
}

function normalizeRateProvider(rateProvider: any): {
  amount: string | null;
  currency: string | null;
} {
  if (!rateProvider) return { amount: null, currency: null };

  if (rateProvider.__typename === "DeliveryRateDefinition") {
    const price = rateProvider.price;
    return {
      amount: price?.amount != null ? String(price.amount) : null,
      currency: price?.currencyCode != null ? String(price.currencyCode) : null,
    };
  }

  if (rateProvider.__typename === "DeliveryParticipant") {
    const fee = rateProvider.fixedFee;
    if (fee?.amount != null) {
      return {
        amount: String(fee.amount),
        currency: fee?.currencyCode != null ? String(fee.currencyCode) : null,
      };
    }
    return { amount: null, currency: null };
  }

  return { amount: null, currency: null };
}

// Небольшая защита от взрывного количества данных
const PAGE_PROFILES = 25; // можно 10-25
const PAGE_ZONES = 25; // было 50
const PAGE_METHODS = 25; // было 50

// ------------------------------
// Queries (split to stay under cost)
// ------------------------------

const Q_PROFILES = `#graphql
query DeliveryProfiles($first: Int!, $after: String) {
  deliveryProfiles(first: $first, after: $after) {
    edges {
      cursor
      node { id }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

const Q_PROFILE_ZONES = `#graphql
query DeliveryProfileZones($id: ID!, $zonesFirst: Int!, $methodsFirst: Int!) {
  deliveryProfile(id: $id) {
    id
    profileLocationGroups {
      locationGroupZones(first: $zonesFirst) {
        edges {
          node {
            zone {
              id
              name
              countries {
                code { countryCode restOfWorld }
                name
              }
            }
            methodDefinitions(first: $methodsFirst) {
              edges {
                node {
                  zone {
                    id
                    name
                    countries {
                      code
                      name
                    }
                    ... on DeliveryParticipant {
                      fixedFee { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

// ------------------------------
// Main
// ------------------------------

export async function getShippingZones(admin: GraphQLClient): Promise<ShippingZone[]> {
  // 1) Fetch all delivery profile IDs with pagination
  const profileIds: string[] = [];
  let after: string | null = null;

  while (true) {
    const res = await adminGraphql(admin, Q_PROFILES, {
      variables: { first: PAGE_PROFILES, after },
    });
    const json = await res.json();

    const conn = json.data?.deliveryProfiles;
    const edges: Array<{ cursor: string; node: { id: string } }> = conn?.edges ?? [];

    for (const e of edges) {
      if (e?.node?.id) profileIds.push(String(e.node.id));
    }

    const pageInfo = conn?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo?.endCursor ?? null;
    if (!after) break;
  }

  // 2) Fetch zones per profile (cheaper per request, avoids cost>1000)
  const zonesById = new Map<string, ShippingZone>();

  for (const id of profileIds) {
    const res = await adminGraphql(admin, Q_PROFILE_ZONES, {
      variables: {
        id,
        zonesFirst: PAGE_ZONES,
        methodsFirst: PAGE_METHODS,
      },
    });

    const json = await res.json();
    const profile = json.data?.deliveryProfile;
    if (!profile) continue;

    const locationGroups = profile.profileLocationGroups ?? [];
    for (const group of locationGroups) {
      const groupZones = getEdges<any>(group.locationGroupZones);

      for (const groupZone of groupZones) {
        const zone = groupZone.zone;
        if (!zone?.id) continue;
        const countries = (zone.countries ?? []).map((country: any) => {
          const rawCode =
            country?.code?.code ??
            country?.code?.countryCode ??
            country?.code ??
            (country?.code?.__typename === "RestOfWorld" ? "ROW" : "") ??
            "";
          return {
            code,
            name: String(country?.name ?? code),
          };
        });

        const rates: ShippingRate[] = getEdges<any>(groupZone.methodDefinitions).map((method) => {
          const price = normalizeRateProvider(method.rateProvider);
          return {
            id: String(method.id ?? ""),
            name: String(method.name ?? ""),
            priceAmount: price.amount,
            currencyCode: price.currency,
          };
        });

        // Deduplicate: merge rates/countries by zone.id
        const existing = zonesById.get(zoneId);
        if (!existing) {
          zonesById.set(zoneId, {
            id: zoneId,
            name: zoneName,
            countries,
            rates,
          });
        } else {
          // merge countries (by code)
          const existingCountryCodes = new Set(existing.countries.map((c) => c.code));
          for (const c of countries) {
            if (!existingCountryCodes.has(c.code)) existing.countries.push(c);
          }

          // merge rates (by id)
          const existingRateIds = new Set(existing.rates.map((r) => r.id));
          for (const r of rates) {
            if (!existingRateIds.has(r.id)) existing.rates.push(r);
          }
        }
      }
    }
  }

  return Array.from(zonesById.values());
}
