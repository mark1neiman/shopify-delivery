import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { processInvoiceJobs } from "../services/invoice-processor.server";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function parseLimit(request: Request): number {
  const url = new URL(request.url);
  const fromQuery = Number(url.searchParams.get("limit") || "");
  if (Number.isFinite(fromQuery) && fromQuery > 0) {
    return Math.min(50, Math.max(1, Math.floor(fromQuery)));
  }
  return 10;
}

async function runProcessor(request: Request) {
  const { admin, session } = await authenticate.admin(request);
  const shop = String(session.shop || "").trim();
  if (!shop) {
    return json({ ok: false, error: "Missing shop in session" }, { status: 400 });
  }

  const limit = parseLimit(request);
  const lockOwner = `admin:${shop}:${Date.now()}`;
  const result = await processInvoiceJobs({
    admin,
    shop,
    limit,
    lockOwner,
  });

  return json({ ok: true, ...result });
}

export async function loader({ request }: LoaderFunctionArgs) {
  return runProcessor(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return runProcessor(request);
}
