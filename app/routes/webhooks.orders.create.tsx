import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { enqueueInvoiceJob, normalizeOrderId } from "../services/invoice-jobs.server";
import { processInvoiceJobs } from "../services/invoice-processor.server";
import { resolveInvoiceLocale } from "../services/invoice-settings.server";

type OrderCreateWebhookPayload = {
  id?: string | number;
  admin_graphql_api_id?: string;
  name?: string;
  email?: string;
  customer_locale?: string;
  locale?: string;
  buyer_locale?: string;
  client_details?: {
    accept_language?: string;
  } | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOrderCreatePayload(payload: unknown): OrderCreateWebhookPayload {
  if (!payload || typeof payload !== "object") return {};
  return payload as OrderCreateWebhookPayload;
}

function detectOrderLocale(payload: OrderCreateWebhookPayload): string {
  return (
    asString(payload.customer_locale) ||
    asString(payload.locale) ||
    asString(payload.buyer_locale) ||
    asString(payload.client_details?.accept_language)
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload: rawPayload, topic, shop, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const payload = asOrderCreatePayload(rawPayload);
    const orderId = normalizeOrderId(payload.admin_graphql_api_id || payload.id);
    if (!orderId) {
      console.warn("[invoice] orders/create webhook missing order id, skipping");
      return new Response();
    }

    const orderLocaleRaw = detectOrderLocale(payload);
    const invoiceLocale = await resolveInvoiceLocale(shop, orderLocaleRaw);

    const result = await enqueueInvoiceJob({
      shop,
      triggerTopic: String(topic || "orders/create"),
      orderId,
      orderName: asString(payload.name),
      orderEmail: asString(payload.email),
      orderLocale: invoiceLocale,
      payload,
    });

    console.log("[invoice] queued job", {
      shop,
      topic,
      orderId,
      invoiceLocale,
      jobId: result.id,
      created: result.created,
    });

    let processorAdmin = admin;
    if (!processorAdmin) {
      try {
        const offlineContext = await unauthenticated.admin(shop);
        processorAdmin = offlineContext.admin;
      } catch (offlineError) {
        console.warn("[invoice] failed to resolve offline admin for webhook processing", {
          shop,
          orderId,
          message: offlineError instanceof Error ? offlineError.message : String(offlineError),
        });
      }
    }

    if (processorAdmin) {
      try {
        const processResult = await processInvoiceJobs({
          admin: processorAdmin,
          shop,
          limit: 1,
          lockOwner: `webhook:${shop}:${orderId}:${Date.now()}`,
        });
        console.log("[invoice] processed from webhook", {
          shop,
          orderId,
          processed: processResult.processed,
          done: processResult.done,
          skipped: processResult.skipped,
          failed: processResult.failed,
        });
      } catch (processError) {
        console.error("[invoice] queued but failed to process from webhook", {
          shop,
          orderId,
          message: processError instanceof Error ? processError.message : String(processError),
        });
      }
    } else {
      console.warn("[invoice] queued but webhook has no admin context; requires background processor", {
        shop,
        orderId,
      });
    }
  } catch (error) {
    console.error("[invoice] failed to enqueue invoice job", error);
    return new Response(null, { status: 500 });
  }

  return new Response();
};
