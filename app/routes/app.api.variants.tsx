import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { adminGraphql } from "../shipping.server";

function json(data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET /app/api/variants?q=gel
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const idsParam = (url.searchParams.get("ids") || "").trim();
  const ids = idsParam
    .split(",")
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .map((id) => (id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id.replace(/[^\d]/g, "")}`));
  if (!q && !ids.length) return json({ items: [] });

  // IMPORTANT: adjust if your auth helper differs
  const ctx = await authenticate.admin(request);
  const admin = ctx.admin;

  let nodes: any[] = [];

  if (ids.length) {
    const byIdsQuery = `#graphql
      query VariantsByIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            sku
            product { title }
          }
        }
      }
    `;
    const r = await adminGraphql(admin, byIdsQuery, { variables: { ids } });
    const j = await r.json();
    nodes = (j?.data?.nodes ?? []).filter(Boolean);
  } else {
    const bySearchQuery = `#graphql
      query Variants($query: String!) {
        productVariants(first: 20, query: $query) {
          nodes {
            id
            title
            sku
            product { title }
          }
        }
      }
    `;
    const r = await adminGraphql(admin, bySearchQuery, { variables: { query: q } });
    const j = await r.json();
    nodes = j?.data?.productVariants?.nodes ?? [];
  }

  return json({
    items: nodes.map((v: any) => ({
      id: String(v.id),
      title: `${v.product?.title || ""} — ${v.title || ""}`.trim(),
      sku: v.sku || "",
    })),
  });
}
