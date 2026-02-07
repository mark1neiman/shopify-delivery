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
  if (!q) return json({ items: [] });

  // IMPORTANT: adjust if your auth helper differs
  const ctx = await authenticate.admin(request);
  const admin = ctx.admin;

  const query = `#graphql
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
  const r = await adminGraphql(admin, query, { variables: { query: q } });
  const j = await r.json();
  const nodes = j?.data?.productVariants?.nodes ?? [];
  return json({
    items: nodes.map((v: any) => ({
      id: String(v.id),
      title: `${v.product?.title || ""} — ${v.title || ""}`.trim(),
      sku: v.sku || "",
    })),
  });
}
