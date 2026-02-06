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

type GraphQLClient = {
  graphql?: ((query: string, options?: { variables?: any }) => Promise<any>) & {
    query?: (args: { data: string; variables?: any }) => Promise<any>;
    request?: (query: string, options?: { variables?: any }) => Promise<any>;
  };
};

export async function adminGraphql(
  admin: GraphQLClient,
  query: string,
  options?: { variables?: any },
) {
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

function getEdges<T>(connection?: { edges?: { node: T }[] } | null): T[] {
  return connection?.edges?.map((edge) => edge.node) ?? [];
}

function normalizePrice(rateDefinition: any): {
  amount: string | null;
  currency: string | null;
} {
  if (!rateDefinition) {
    return { amount: null, currency: null };
  }

  const price = rateDefinition.price ?? rateDefinition.amount ?? null;
  if (price?.amount != null) {
    return {
      amount: String(price.amount),
      currency: price.currencyCode ? String(price.currencyCode) : null,
    };
  }

  if (typeof price === "string" || typeof price === "number") {
    return { amount: String(price), currency: null };
  }

  return { amount: null, currency: null };
}

export async function getShippingZones(admin: GraphQLClient): Promise<ShippingZone[]> {
  const query = `#graphql
  query ShippingZones {
    deliveryProfiles(first: 25) {
      edges {
        node {
          id
          name
          profileLocationGroups {
            locationGroupZones(first: 50) {
              edges {
                node {
                  zone {
                    id
                    name
                    countries {
                      code {
                        ... on CountryCode {
                          code
                        }
                        ... on RestOfWorld {
                          __typename
                        }
                      }
                      name
                    }
                  }
                  methodDefinitions(first: 50) {
                    edges {
                      node {
                        id
                        name
                        rateDefinition {
                          __typename
                          ... on DeliveryRateDefinition {
                            price {
                              amount
                              currencyCode
                            }
                          }
                          ... on ShippingRateDefinition {
                            price {
                              amount
                              currencyCode
                            }
                          }
                          ... on DeliveryRateDefinitionV2 {
                            price {
                              amount
                              currencyCode
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
        }
      }
    }
  }`;

  const res = await adminGraphql(admin, query);
  const json = await res.json();
  const profiles = getEdges<{ profileLocationGroups?: any }>(
    json.data?.deliveryProfiles,
  );

  const zones: ShippingZone[] = [];

  for (const profile of profiles) {
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
            (country?.code?.__typename === "RestOfWorld" ? "ROW" : "") ??
            "";
          return {
            code: String(rawCode).toUpperCase(),
            name: String(country.name ?? rawCode ?? ""),
          };
        });

        const rates = getEdges<any>(groupZone.methodDefinitions).map(
          (method) => {
            const price = normalizePrice(method.rateDefinition);
            return {
              id: String(method.id ?? ""),
              name: String(method.name ?? ""),
              priceAmount: price.amount,
              currencyCode: price.currency,
            } as ShippingRate;
          },
        );

        zones.push({
          id: String(zone.id),
          name: String(zone.name ?? ""),
          countries,
          rates,
        });
      }
    }
  }

  return zones;
}
