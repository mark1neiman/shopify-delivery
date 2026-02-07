import { adminGraphql } from "../shipping.server";

export type PromoInput = {
  title: string;
  code: string;
  startsAt: string; // ISO
  endsAt: string | null; // ISO or null
  type: "percentage" | "fixed";
  value: number;
  currencyCode?: string; // for fixed
  // simplest targeting:
  segmentIds: string[]; // e.g. ["gid://shopify/Segment/123"]
  appliesOncePerCustomer?: boolean;
  usageLimit?: number | null;
};

export async function createPromoCodeBasic(admin: any, input: PromoInput) {
  const mutation = `#graphql
    mutation Create($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }
  `;

  const value =
    input.type === "percentage"
      ? { percentage: input.value }
      : { discountAmount: { amount: String(input.value), appliesOnEachItem: false } };

  const basicCodeDiscount: any = {
    title: input.title,
    code: input.code,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    customerGets: {
      value,
      items: { all: true },
    },
    appliesOncePerCustomer: Boolean(input.appliesOncePerCustomer),
  };

  if (input.usageLimit && input.usageLimit > 0) basicCodeDiscount.usageLimit = input.usageLimit;

  if (input.segmentIds?.length) {
    basicCodeDiscount.context = {
      customerSegments: { add: input.segmentIds },
    };
  }

  const r = await adminGraphql(admin, mutation, { variables: { basicCodeDiscount } });
  const j = await r.json();
  const errs = j?.data?.discountCodeBasicCreate?.userErrors ?? [];
  if (errs.length) throw new Error(JSON.stringify(errs));
  return j?.data?.discountCodeBasicCreate?.codeDiscountNode?.id as string;
}

export async function listPromoCodes(admin: any) {
  const q = `#graphql
    query {
      discountNodes(first: 50, query: "type:code") {
        nodes {
          id
          discount {
            __typename
            ... on DiscountCodeBasic {
              title
              startsAt
              endsAt
              status
              summary
              codes(first: 10) { nodes { code } }
            }
          }
        }
      }
    }
  `;
  const r = await adminGraphql(admin, q);
  const j = await r.json();
  const nodes = j?.data?.discountNodes?.nodes ?? [];
  return nodes
    .map((n: any) => {
      const d = n.discount;
      if (!d || d.__typename !== "DiscountCodeBasic") return null;
      return {
        id: String(n.id),
        title: d.title,
        code: d.codes?.nodes?.[0]?.code || "",
        startsAt: d.startsAt,
        endsAt: d.endsAt,
        status: d.status,
        summary: d.summary,
      };
    })
    .filter(Boolean);
}

export async function deletePromoCode(admin: any, discountId: string) {
  const m = `#graphql
    mutation Delete($id: ID!) {
      discountCodeDelete(id: $id) {
        deletedDiscountId
        userErrors { field message }
      }
    }
  `;
  const r = await adminGraphql(admin, m, { variables: { id: discountId } });
  const j = await r.json();
  const errs = j?.data?.discountCodeDelete?.userErrors ?? [];
  if (errs.length) throw new Error(JSON.stringify(errs));
}
