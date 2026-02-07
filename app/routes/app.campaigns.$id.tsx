import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useParams } from "react-router";
import { authenticate } from "../shopify.server";
import {
  ensureCampaignMetaobjectDefinition,
  getCampaign,
  upsertCampaign,
} from "../services/campaigns-metaobjects.server";

function json(data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await authenticate.admin(request);
  await ensureCampaignMetaobjectDefinition(ctx.admin);

  const id = String(params.id || "");
  if (id === "new") {
    return json({
      campaign: {
        id: "",
        label: "",
        campaignType: "BuyXGetOneFree",
        priority: "10",
        stackable: "true",
        configJson: JSON.stringify({ buyQuantity: 2, eligibleVariantIds: [] }, null, 2),
      },
    });
  }

  const campaign = await getCampaign(ctx.admin, id);
  if (!campaign) return json({ error: "Not found" }, { status: 404 });
  return json({ campaign });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const ctx = await authenticate.admin(request);
  const id = String(params.id || "");
  const fd = await request.formData();

  const label = String(fd.get("label") || "").trim();
  const campaignType = String(fd.get("campaignType") || "").trim();
  const priority = Number(fd.get("priority") || 0);
  const stackable = String(fd.get("stackable") || "false") === "true";
  const configJson = String(fd.get("configJson") || "{}");

  // basic validation (config must be JSON)
  try {
    JSON.parse(configJson);
  } catch {
    return json({ error: "configJson must be valid JSON" }, { status: 400 });
  }

  const savedId = await upsertCampaign(ctx.admin, {
    id: id === "new" ? undefined : id,
    label,
    campaignType,
    priority,
    stackable,
    configJson,
  });

  return json({ ok: true, id: savedId });
}

export default function CampaignEditPage() {
  const data = useLoaderData() as any;
  const params = useParams();
  const isNew = params.id === "new";
  const c = data.campaign;

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>{isNew ? "Create campaign" : "Edit campaign"}</h1>
        <Link to="/app/campaigns">← Back</Link>
      </div>

      <Form method="post" style={{ display: "grid", gap: 12 }}>
        <label>
          Label
          <input name="label" defaultValue={c.label} style={{ width: "100%", padding: 10 }} />
        </label>

        <label>
          Type
          <select name="campaignType" defaultValue={c.campaignType} style={{ width: "100%", padding: 10 }}>
            <option value="BuyXGetOneFree">BuyXGetOneFree</option>
            <option value="BuyXGetZFree">BuyXGetZFree</option>
            <option value="BuyXGetZChoice">BuyXGetZChoice</option>
            <option value="CartThresholdDiscount">CartThresholdDiscount</option>
            <option value="CartThresholdFreeChoice">CartThresholdFreeChoice</option>
          </select>
        </label>

        <label>
          Priority
          <input name="priority" type="number" defaultValue={c.priority} style={{ width: "100%", padding: 10 }} />
        </label>

        <label>
          Stackable
          <select name="stackable" defaultValue={c.stackable} style={{ width: "100%", padding: 10 }}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>

        <label>
          Config JSON
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>
            Вставляй variant GID’ы. Быстро найти: /app/api/variants?q=...
          </div>
          <textarea
            name="configJson"
            defaultValue={c.configJson}
            rows={18}
            style={{ width: "100%", padding: 10, fontFamily: "monospace" }}
          />
        </label>

        <button type="submit" style={{ padding: "10px 14px", fontWeight: 700 }}>
          Save
        </button>
      </Form>
    </div>
  );
}
