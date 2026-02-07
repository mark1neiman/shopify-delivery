import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { createPromoCodeBasic, deletePromoCode, listPromoCodes } from "../services/promo-codes.server";

function json(data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await authenticate.admin(request);
  const promos = await listPromoCodes(ctx.admin);
  return json({ promos });
}

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent === "create") {
    const title = String(fd.get("title") || "").trim();
    const code = String(fd.get("code") || "").trim();
    const type = String(fd.get("type") || "percentage") as "percentage" | "fixed";
    const value = Number(fd.get("value") || 0);

    const startsAt = String(fd.get("startsAt") || new Date().toISOString());
    const endsAtRaw = String(fd.get("endsAt") || "").trim();
    const endsAt = endsAtRaw ? endsAtRaw : null;

    // simplest targeting: segment ids comma-separated (optional)
    const segmentIds = String(fd.get("segmentIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    await createPromoCodeBasic(ctx.admin, {
      title,
      code,
      type,
      value,
      startsAt,
      endsAt,
      segmentIds,
      appliesOncePerCustomer: String(fd.get("oncePerCustomer") || "false") === "true",
      usageLimit: Number(fd.get("usageLimit") || 0) || null,
    });

    return json({ ok: true });
  }

  if (intent === "delete") {
    const id = String(fd.get("id") || "");
    if (id) await deletePromoCode(ctx.admin, id);
    return json({ ok: true });
  }

  return json({ ok: false }, { status: 400 });
}

export default function PromoCodesPage() {
  const data = useLoaderData() as any;

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1>Promo codes</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, marginBottom: 16 }}>
        <h3>Create promo</h3>
        <Form method="post" style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="intent" value="create" />

          <label>Title <input name="title" style={{ width: "100%", padding: 10 }} /></label>
          <label>Code <input name="code" style={{ width: "100%", padding: 10 }} /></label>

          <label>
            Type
            <select name="type" style={{ width: "100%", padding: 10 }}>
              <option value="percentage">percentage</option>
              <option value="fixed">fixed</option>
            </select>
          </label>

          <label>Value <input name="value" type="number" step="0.01" style={{ width: "100%", padding: 10 }} /></label>

          <label>StartsAt (ISO) <input name="startsAt" defaultValue={new Date().toISOString()} style={{ width: "100%", padding: 10 }} /></label>
          <label>EndsAt (ISO or empty) <input name="endsAt" placeholder="2026-12-31T23:59:59Z" style={{ width: "100%", padding: 10 }} /></label>

          <label>Segment IDs (comma-separated, optional) <input name="segmentIds" placeholder="gid://shopify/Segment/..." style={{ width: "100%", padding: 10 }} /></label>

          <label>
            Once per customer
            <select name="oncePerCustomer" style={{ width: "100%", padding: 10 }}>
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          </label>

          <label>Usage limit (0 = unlimited) <input name="usageLimit" type="number" style={{ width: "100%", padding: 10 }} /></label>

          <button type="submit" style={{ padding: "10px 14px", fontWeight: 700 }}>Create</button>
        </Form>
      </div>

      <h3>Existing promos</h3>
      <div style={{ display: "grid", gap: 10 }}>
        {data.promos.map((p: any) => (
          <div key={p.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700 }}>{p.title} — {p.code}</div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              {p.status} · {p.startsAt} → {p.endsAt || "no end"} · {p.summary}
            </div>
            <Form method="post" style={{ marginTop: 10 }}>
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={p.id} />
              <button type="submit">Delete</button>
            </Form>
          </div>
        ))}
      </div>
    </div>
  );
}
