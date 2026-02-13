import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import db from "../db.server";
import { adminGraphql } from "../shipping.server";
import { authenticate } from "../shopify.server";
import { enqueueInvoiceJob, normalizeOrderId } from "../services/invoice-jobs.server";
import { processInvoiceJobs } from "../services/invoice-processor.server";
import { generateInvoicePdf } from "../services/invoice-pdf.server";
import { resolveInvoiceLocale } from "../services/invoice-settings.server";
import {
  deleteInvoiceLocaleMapping,
  getInvoiceAdminSettings,
  listInvoiceLocaleMappings,
  upsertInvoiceAdminSettings,
  upsertInvoiceLocaleMapping,
  type InvoiceLocale,
  type InvoiceLocaleMappingRecord,
} from "../services/invoice-admin.server";

type AdminGraphqlClient = Parameters<typeof adminGraphql>[0];

type StorefrontLocaleOption = {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
};

type ShopBranding = {
  shopName: string;
  shopEmail: string;
  shopUrl: string;
  logoUrl: string;
};

type LoaderData = {
  settings: {
    enabled: boolean;
    defaultLocale: InvoiceLocale;
  };
  storefrontLocales: StorefrontLocaleOption[];
  mappings: InvoiceLocaleMappingRecord[];
  previewLocale: InvoiceLocale;
  previewPdfDataUrl: string;
};

type ActionData = {
  ok: false;
  error: string;
} | {
  ok: true;
  message: string;
  orderId: string;
  status: "done" | "queued" | "skipped" | "failed";
  invoiceUrl?: string;
  invoiceDownloadUrl?: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeLocale(value: unknown): InvoiceLocale {
  return asString(value).toLowerCase().startsWith("et") ? "et" : "en";
}

function checked(formData: FormData, key: string): boolean {
  const value = asString(formData.get(key));
  return value === "on" || value === "true" || value === "1";
}

function invoiceRedirect(previewLocale?: string) {
  const locale = normalizeLocale(previewLocale || "en");
  return redirect(`/app/invoice?previewLocale=${locale}`);
}

function toInvoiceDownloadUrl(value: string): string {
  const urlValue = asString(value);
  if (!urlValue) return "";

  try {
    const parsed = new URL(urlValue);
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  } catch {
    return `${urlValue}${urlValue.includes("?") ? "&" : "?"}download=1`;
  }
}

async function getLatestInvoiceUrl(shop: string, orderId: string): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ pdfUrl: string | null }[]>(
    `
    SELECT "pdfUrl"
    FROM "InvoiceDocument"
    WHERE "shop" = ? AND "orderId" = ? AND "pdfUrl" IS NOT NULL
    ORDER BY "updatedAt" DESC
    LIMIT 1
    `,
    shop,
    orderId,
  );
  return asString(rows?.[0]?.pdfUrl);
}

function fallbackLocales(): StorefrontLocaleOption[] {
  return [
    { locale: "en", name: "English", primary: true, published: true },
    { locale: "et", name: "Estonian", primary: false, published: true },
  ];
}

async function getStorefrontLocales(admin: AdminGraphqlClient): Promise<StorefrontLocaleOption[]> {
  try {
    const response = await adminGraphql(
      admin,
      `#graphql
      query InvoiceStoreLocales {
        shopLocales {
          locale
          name
          primary
          published
        }
      }`,
    );

    const json = await response.json();
    const root = asObject(json);
    const errors = Array.isArray(root?.errors) ? root.errors : [];
    if (errors.length > 0) return fallbackLocales();

    const data = asObject(root?.data);
    const rawLocales = Array.isArray(data?.shopLocales) ? data.shopLocales : [];
    const locales = rawLocales
      .map((item) => {
        const locale = asObject(item);
        if (!locale) return null;
        const code = asString(locale.locale).toLowerCase();
        if (!code) return null;
        return {
          locale: code,
          name: asString(locale.name) || code,
          primary: Boolean(locale.primary),
          published: Boolean(locale.published),
        } satisfies StorefrontLocaleOption;
      })
      .filter((item): item is StorefrontLocaleOption => Boolean(item));

    if (locales.length === 0) return fallbackLocales();

    return locales.sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return a.locale.localeCompare(b.locale);
    });
  } catch {
    return fallbackLocales();
  }
}

async function getShopBranding(admin: AdminGraphqlClient): Promise<ShopBranding | null> {
  try {
    const response = await adminGraphql(
      admin,
      `#graphql
      query InvoiceShopBrandingPreview {
        shop {
          name
          email
          primaryDomain {
            url
            host
          }
          brand {
            logo {
              image {
                url
              }
            }
            squareLogo {
              image {
                url
              }
            }
          }
        }
      }`,
    );

    const json = await response.json();
    const root = asObject(json);
    const errors = Array.isArray(root?.errors) ? root.errors : [];
    if (errors.length > 0) return null;

    const data = asObject(root?.data);
    const shop = asObject(data?.shop);
    if (!shop) return null;

    const primaryDomain = asObject(shop.primaryDomain);
    const brand = asObject(shop.brand);
    const logo = asObject(brand?.logo);
    const squareLogo = asObject(brand?.squareLogo);
    const logoImage = asObject(logo?.image);
    const squareLogoImage = asObject(squareLogo?.image);

    return {
      shopName: asString(shop.name),
      shopEmail: asString(shop.email),
      shopUrl: asString(primaryDomain?.url) || asString(primaryDomain?.host),
      logoUrl: asString(logoImage?.url) || asString(squareLogoImage?.url),
    };
  } catch {
    return null;
  }
}

function mergeLocaleOptions(options: StorefrontLocaleOption[], extra?: string): StorefrontLocaleOption[] {
  const current = asString(extra).toLowerCase();
  const base = [...options];
  if (current && !base.some((item) => item.locale === current)) {
    base.push({
      locale: current,
      name: `${current} (custom)`,
      primary: false,
      published: false,
    });
  }
  return base;
}

function previewCss() {
  return `
body { font-family: Arial, sans-serif; color: #111; font-size: 12px; margin: 0; padding: 22px; background: #fff; }
.invoice-page { max-width: 920px; margin: 0 auto; }
.receipt-top { display: flex; justify-content: space-between; gap: 10px; color: #666; font-size: 12px; margin-bottom: 16px; }
.brand-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
.brand-identity { display: flex; align-items: center; gap: 14px; }
.seller-logo { max-height: 64px; width: auto; object-fit: contain; display: block; }
.seller-logo[src=""] { display: none; }
.brand-name { font-size: 42px; font-weight: 700; color: #111; line-height: 1; }
.print-link { font-size: 13px; color: #1f3fb6; text-decoration: underline; }
.brand-contact { font-size: 21px; margin-bottom: 14px; }
.order-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; border-bottom: 1px solid #999; padding-bottom: 8px; margin-bottom: 12px; }
.order-meta strong { font-size: 15px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; }
.info-block h3 { margin: 0 0 6px; font-size: 18px; }
.info-block p { margin: 0 0 4px; line-height: 1.35; }
.totals-grid { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; font-size: 17px; margin-top: 2px; }
.totals-grid .value { text-align: right; }
.totals-grid .total { font-weight: 700; margin-top: 4px; }
.invoice-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 16px; }
.invoice-table caption { text-align: left; font-weight: 700; border: 1px solid #7f7f7f; border-bottom: 0; padding: 8px 10px; background: #f5f5f5; }
.invoice-table th, .invoice-table td { border: 1px solid #7f7f7f; padding: 8px 6px; text-align: left; vertical-align: top; }
.invoice-table th { background: #f5f5f5; font-size: 16px; }
.invoice-table td.num, .invoice-table th.num { text-align: right; white-space: nowrap; }
.extra-discount { margin-top: 10px; border: 1px solid #7f7f7f; padding: 8px 10px; display: flex; justify-content: space-between; gap: 12px; font-size: 16px; }
.extra-discount strong { font-weight: 700; }
.legal { margin-top: 12px; font-size: 16px; line-height: 1.35; }
.legal p { margin: 8px 0; }
`;
}

function previewHtml(locale: InvoiceLocale) {
  const labels =
    locale === "et"
      ? {
          topCaption: "Kviitung",
          printLabel: "Prindi",
          orderNumber: "Tellimuse number",
          dateOfOrder: "Tellimuse kuupaev",
          shippingAddress: "Tarneaadress",
          billingAddress: "Arveldusaadress",
          orderTotals: "Tellimuse summad",
          payment: "Makse",
          trackingInfo: "Tarneviis / Jalgimine",
          subtotal: "Vahesumma",
          shipping: "Tarne",
          tax: "KM",
          discount: "Allahindlus",
          total: "Kokku",
          extraDiscounts: "Lisallahindlused",
          contactInformation: "Kontaktandmed",
          webLabel: "Veeb",
          emailLabel: "Email",
          disclaimerTitle: "Marge",
          returnPolicyTitle: "Tagastusreeglid",
          itemNo: "#",
          item: "Toode",
          sku: "SKU",
          unitPrice: "Uhiku hind",
          qty: "Kogus",
        }
      : {
          topCaption: "Receipt",
          printLabel: "Print",
          orderNumber: "Order Number",
          dateOfOrder: "Date of Order",
          shippingAddress: "Shipping Address",
          billingAddress: "Billing Address",
          orderTotals: "Order Totals",
          payment: "Payment",
          trackingInfo: "Shipping Method / Tracking Info",
          subtotal: "Subtotal",
          shipping: "Shipping",
          tax: "Tax",
          discount: "Discount",
          total: "Order Total",
          extraDiscounts: "Extra Discounts",
          contactInformation: "Contact Information",
          webLabel: "Web",
          emailLabel: "Email",
          disclaimerTitle: "Disclaimer",
          returnPolicyTitle: "Return Policy",
          itemNo: "#",
          item: "Item",
          sku: "SKU",
          unitPrice: "Price",
          qty: "Qty.",
        };

  return `
<html>
  <head>
    <meta charset="utf-8" />
    <style>{{template.css}}</style>
  </head>
  <body>
    <main class="invoice-page">
      <div class="receipt-top">
        <span>{{invoice.date}}</span>
        <span>${labels.topCaption} - {{seller.name}}</span>
      </div>

      <div class="brand-row">
        <div class="brand-identity">
          <img class="seller-logo" src="{{seller.logo_url}}" alt="{{seller.name}}" />
          <div class="brand-name">{{seller.name}}</div>
        </div>
        <span class="print-link">${labels.printLabel}</span>
      </div>
      <div class="brand-contact">{{seller.website}} | {{seller.email}}</div>

      <section class="order-meta">
        <div><strong>${labels.orderNumber}. {{invoice.number}}</strong></div>
        <div><strong>${labels.dateOfOrder}. {{invoice.date}}</strong></div>
      </section>

      <section class="grid-2">
        <div class="info-block">
          <h3>${labels.shippingAddress}:</h3>
          <p>{{shipping.address_html}}</p>
        </div>
        <div class="info-block">
          <h3>${labels.billingAddress}:</h3>
          <p>{{customer.name}}</p>
          <p>{{billing.address_html}}</p>
        </div>
      </section>

      <section class="grid-2">
        <div class="info-block">
          <h3>${labels.orderTotals}:</h3>
          <div class="totals-grid">
            <span>${labels.subtotal}</span><span class="value">{{totals.subtotal}}</span>
            <span>${labels.shipping}</span><span class="value">{{totals.shipping}}</span>
            <span>${labels.tax}</span><span class="value">{{totals.tax}}</span>
            <span>${labels.discount}</span><span class="value">{{totals.discounts}}</span>
            <span class="total">${labels.total}</span><span class="value total">{{totals.total}}</span>
          </div>
        </div>
        <div class="info-block">
          <h3>${labels.payment}:</h3>
          <p>{{payment.method}}</p>
          <p><strong>${labels.trackingInfo}</strong></p>
          <p>{{shipping.title}}</p>
          <p>VAT ID: {{seller.vat_id}} | Reg. No.: {{seller.registration_id}}</p>
        </div>
      </section>

      <table class="invoice-table">
        <caption>${labels.orderNumber}: {{invoice.number}}</caption>
        <thead>
          <tr>
            <th>${labels.itemNo}</th>
            <th>${labels.item}</th>
            <th>${labels.sku}</th>
            <th class="num">${labels.unitPrice}</th>
            <th class="num">${labels.qty}</th>
            <th class="num">${labels.discount}</th>
            <th class="num">${labels.subtotal}</th>
          </tr>
        </thead>
        <tbody>
          {{order.items_rows}}
        </tbody>
      </table>

      <div class="extra-discount">
        <span><strong>${labels.extraDiscounts}:</strong> {{legal.additional_note}}</span>
        <strong>{{totals.discounts}}</strong>
      </div>

      <section class="legal">
        <p><strong>${labels.contactInformation}:</strong> ${labels.webLabel}: {{seller.website}} | ${labels.emailLabel}: {{seller.email}}</p>
        <p><strong>${labels.disclaimerTitle}:</strong> {{legal.vat_note}}</p>
        <p><strong>${labels.returnPolicyTitle}:</strong> {{legal.return_policy_note}}</p>
      </section>
    </main>
  </body>
</html>`;
}

function sampleTokens(locale: InvoiceLocale, branding: ShopBranding | null): Record<string, string> {
  const totals =
    locale === "et"
      ? {
          subtotal: "279,79 €",
          shipping: "0,00 €",
          tax: "0,00 €",
          discounts: "69,95 €",
          total: "279,79 €",
        }
      : {
          subtotal: "$279.79",
          shipping: "$0.00",
          tax: "$0.00",
          discounts: "$69.95",
          total: "$279.79",
        };

  const sellerName = asString(process.env.INVOICE_SELLER_NAME) || asString(branding?.shopName) || "NANAILS.EU";
  const sellerEmail = asString(process.env.INVOICE_SELLER_EMAIL) || asString(branding?.shopEmail) || "info@nanails.eu";
  const sellerWebsite = asString(process.env.INVOICE_SELLER_WEBSITE) || asString(branding?.shopUrl) || "https://nanails.eu";
  const sellerLogo = asString(process.env.INVOICE_SELLER_LOGO_URL) || asString(branding?.logoUrl);

  return {
    "invoice.date": "June 03 2021",
    "invoice.number": "717313138",
    "seller.name": sellerName,
    "seller.website": sellerWebsite,
    "seller.email": sellerEmail,
    "seller.logo_url": sellerLogo,
    "seller.vat_id": asString(process.env.INVOICE_SELLER_VAT_ID) || "EE101780520",
    "seller.registration_id": asString(process.env.INVOICE_SELLER_REGISTRATION_ID) || "12741701",
    "order.name": "#717313138",
    "customer.name": "Mega Indah Cargo PTE LTD qq Parceldaddy Air",
    "billing.address_html": "115 Airport Cargo Road<br/>#02-07, Cargo Agents Building C<br/>Singapore, SG 819155",
    "shipping.address_html": "115 Airport Cargo Road<br/>#02-07, Cargo Agents Building C<br/>Singapore, SG 819155",
    "payment.method": "Braintree_PayPal",
    "shipping.title": "CJ Singapore Express / IH30000036220",
    "totals.subtotal": totals.subtotal,
    "totals.shipping": totals.shipping,
    "totals.tax": totals.tax,
    "totals.discounts": totals.discounts,
    "totals.total": totals.total,
    "legal.additional_note": locale === "et" ? "Lisallahindlus rakendus." : "Extra 20% discounts applied!",
    "legal.vat_note":
      locale === "et"
        ? "KM vastavalt kohalduvatele EL kaibemaksureeglitele."
        : "VAT is charged according to applicable EU VAT rules.",
    "legal.return_policy_note":
      locale === "et"
        ? "Tagastuse algatamiseks votke klienditoega uhendust 60 paeva jooksul."
        : "If you are unsatisfied with your order, contact support within 60 days.",
    "order.items_rows":
      "<tr><td class=\"num\">1</td><td>Nature's Plus, Vitamin D3, 25 mcg (1,000 IU), 180 Softgels</td><td>NP-01042</td><td class=\"num\">$12.06</td><td class=\"num\">29</td><td class=\"num\">-$69.95</td><td class=\"num\">$279.79</td></tr>",
  };
}

function buildPreviewPdfDataUrl(locale: InvoiceLocale, branding: ShopBranding | null): string {
  const sellerName = asString(process.env.INVOICE_SELLER_NAME) || asString(branding?.shopName) || "NANAILS.EU";
  const sellerEmail = asString(process.env.INVOICE_SELLER_EMAIL) || asString(branding?.shopEmail) || "info@nanails.eu";
  const sellerWebsite = asString(process.env.INVOICE_SELLER_WEBSITE) || asString(branding?.shopUrl) || "https://nanails.eu";
  const orderNumber = "#717313138";

  const labels =
    locale === "et"
      ? {
          topCaption: "Kviitung",
          printLabel: "Prindi",
          orderNumber: "Tellimuse number",
          dateOfOrder: "Tellimuse kuupaev",
          shippingAddress: "Tarneaadress",
          billingAddress: "Arveldusaadress",
          orderTotals: "Tellimuse summad",
          payment: "Makse",
          trackingInfo: "Tarneviis / Jalgimine",
          extraDiscounts: "Lisallahindlused",
          contactInformation: "Kontaktandmed",
          webLabel: "Veeb",
          emailLabel: "Email",
          disclaimerTitle: "Marge",
          returnPolicyTitle: "Tagastusreeglid",
          vatId: "KMKR",
          registrationId: "Registrikood",
          itemNo: "#",
          item: "Toode",
          sku: "SKU",
          unitPrice: "Uhiku hind",
          qty: "Kogus",
          discount: "Allahindlus",
          subtotal: "Vahesumma",
          shipping: "Tarne",
          tax: "KM",
          total: "Kokku",
        }
      : {
          topCaption: "Receipt",
          printLabel: "Print",
          orderNumber: "Order Number",
          dateOfOrder: "Date of Order",
          shippingAddress: "Shipping Address",
          billingAddress: "Billing Address",
          orderTotals: "Order Totals",
          payment: "Payment",
          trackingInfo: "Shipping Method / Tracking Info",
          extraDiscounts: "Extra Discounts",
          contactInformation: "Contact Information",
          webLabel: "Web",
          emailLabel: "Email",
          disclaimerTitle: "Disclaimer",
          returnPolicyTitle: "Return Policy",
          vatId: "VAT ID",
          registrationId: "Reg. No.",
          itemNo: "#",
          item: "Item",
          sku: "SKU",
          unitPrice: "Price",
          qty: "Qty.",
          discount: "Discount",
          subtotal: "Subtotal",
          shipping: "Shipping",
          tax: "Tax",
          total: "Order Total",
        };

  const totals =
    locale === "et"
      ? {
          subtotal: "279,79 EUR",
          shipping: "0,00 EUR",
          tax: "0,00 EUR",
          discounts: "69,95 EUR",
          total: "279,79 EUR",
        }
      : {
          subtotal: "279.79 USD",
          shipping: "0.00 USD",
          tax: "0.00 USD",
          discounts: "69.95 USD",
          total: "279.79 USD",
        };

  const buffer = generateInvoicePdf({
    topDate: locale === "et" ? "03.06.2021" : "03 Jun 2021",
    topCaption: `${labels.topCaption} - ${sellerName}`,
    printLabel: labels.printLabel,
    sellerName,
    brandContactLine: `${sellerWebsite} | ${sellerEmail}`,
    orderMetaLeft: `${labels.orderNumber}. ${orderNumber}`,
    orderMetaRight: `${labels.dateOfOrder}. ${locale === "et" ? "03.06.2021" : "03 Jun 2021"}`,
    shipping: {
      title: `${labels.shippingAddress}:`,
      lines: [
        "Mega Indah Cargo PTE LTD qq Parceldaddy Air",
        "115 Airport Cargo Road",
        "#02-07, Cargo Agents Building C",
        "Singapore, SG 819155",
      ],
    },
    billing: {
      title: `${labels.billingAddress}:`,
      lines: [
        "Mega Indah Cargo PTE LTD qq Parceldaddy Air",
        "115 Airport Cargo Road",
        "#02-07, Cargo Agents Building C",
        "Singapore, SG 819155",
      ],
    },
    totalsTitle: `${labels.orderTotals}:`,
    totalsRows: [
      { label: labels.subtotal, value: totals.subtotal },
      { label: labels.shipping, value: totals.shipping },
      { label: labels.tax, value: totals.tax },
      { label: labels.discount, value: totals.discounts },
      { label: labels.total, value: totals.total, strong: true },
    ],
    paymentTitle: `${labels.payment}:`,
    paymentMethod: "Braintree_PayPal",
    trackingLabel: labels.trackingInfo,
    shippingMethod: "CJ Singapore Express / IH30000036220",
    vatRegistrationLine: `${labels.vatId}: EE101780520 | ${labels.registrationId}: 12741701`,
    tableCaption: `${labels.orderNumber}: ${orderNumber}`,
    tableHeaders: {
      index: labels.itemNo,
      item: labels.item,
      sku: labels.sku,
      qty: labels.qty,
      unitPrice: labels.unitPrice,
      discount: labels.discount,
      subtotal: labels.subtotal,
    },
    items: [
      {
        index: 1,
        description: "Nature's Plus, Vitamin D3, 25 mcg (1,000 IU), 180 Softgels",
        sku: "NP-01042",
        quantity: 29,
        unitPrice: locale === "et" ? "12,06 EUR" : "12.06 USD",
        discount: locale === "et" ? "69,95 EUR" : "69.95 USD",
        subtotal: locale === "et" ? "279,79 EUR" : "279.79 USD",
      },
    ],
    extraDiscountLabel: labels.extraDiscounts,
    extraDiscountNote: locale === "et" ? "Lisallahindlus rakendus." : "Extra 20% discounts applied!",
    extraDiscountValue: totals.discounts,
    legalLines: [
      `${labels.contactInformation}: ${labels.webLabel}: ${sellerWebsite} | ${labels.emailLabel}: ${sellerEmail}`,
      locale === "et"
        ? `${labels.disclaimerTitle}: KM vastavalt kohalduvatele EL kaibemaksureeglitele.`
        : `${labels.disclaimerTitle}: VAT is charged according to applicable EU VAT rules.`,
      locale === "et"
        ? `${labels.returnPolicyTitle}: Tagastuse algatamiseks votke klienditoega uhendust 60 paeva jooksul.`
        : `${labels.returnPolicyTitle}: If you are unsatisfied with your order, contact support within 60 days.`,
    ],
  });

  return `data:application/pdf;base64,${buffer.toString("base64")}`;
}

function applyPreviewTemplate(html: string, css: string, tokens: Record<string, string>): string {
  const htmlWithCss = html.replace(/\{\{\s*template\.css\s*\}\}/g, css);
  return htmlWithCss.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_full, tokenName: string) => {
    return tokens[tokenName] ?? "";
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = asString(session.shop);
  if (!shop) {
    throw new Error("Missing shop in session");
  }

  const [settingsRecord, mappings, storefrontLocales, branding] = await Promise.all([
    getInvoiceAdminSettings(shop),
    listInvoiceLocaleMappings(shop),
    getStorefrontLocales(admin),
    getShopBranding(admin),
  ]);

  const url = new URL(request.url);
  const previewLocale = normalizeLocale(url.searchParams.get("previewLocale") || settingsRecord?.defaultLocale || "en");
  void applyPreviewTemplate(previewHtml(previewLocale), previewCss(), sampleTokens(previewLocale, branding));

  const data: LoaderData = {
    settings: {
      enabled: Boolean(settingsRecord?.enabled),
      defaultLocale: normalizeLocale(settingsRecord?.defaultLocale || "en"),
    },
    storefrontLocales,
    mappings,
    previewLocale,
    previewPdfDataUrl: buildPreviewPdfDataUrl(previewLocale, branding),
  };

  return Response.json(data);
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = asString(session.shop);
  if (!shop) {
    return Response.json({ ok: false, error: "Missing shop in session" } satisfies ActionData, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const intent = asString(formData.get("intent"));
    const previewLocale = normalizeLocale(formData.get("previewLocale") || "en");

    if (intent === "save_settings") {
      await upsertInvoiceAdminSettings(shop, {
        enabled: checked(formData, "enabled"),
        defaultLocale: normalizeLocale(formData.get("defaultLocale")),
      });
      return invoiceRedirect(previewLocale);
    }

    if (intent === "upsert_mapping") {
      await upsertInvoiceLocaleMapping(shop, {
        storefrontLang: asString(formData.get("storefrontLang")),
        invoiceLocale: normalizeLocale(formData.get("invoiceLocale")),
        templateId: null,
      });
      return invoiceRedirect(previewLocale);
    }

    if (intent === "delete_mapping") {
      await deleteInvoiceLocaleMapping(shop, asString(formData.get("mappingId")));
      return invoiceRedirect(previewLocale);
    }

    if (intent === "regenerate_order_invoice") {
      const orderRef = asString(formData.get("orderRef"));
      const orderId = normalizeOrderId(orderRef);
      if (!orderId) {
        return Response.json(
          { ok: false, error: "Enter a valid order number or numeric order ID" } satisfies ActionData,
          { status: 400 },
        );
      }

      const invoiceLocale = await resolveInvoiceLocale(shop, "");
      await enqueueInvoiceJob({
        shop,
        triggerTopic: "manual/regenerate",
        orderId,
        orderLocale: invoiceLocale,
      });

      const result = await processInvoiceJobs({
        admin,
        shop,
        limit: 1,
        preferredOrderId: orderId,
        lockOwner: `manual:${shop}:${orderId}:${Date.now()}`,
      });
      const processedJob = result.jobs.find((job) => job.orderId === orderId);
      const invoiceUrl = await getLatestInvoiceUrl(shop, orderId);
      const invoiceDownloadUrl = toInvoiceDownloadUrl(invoiceUrl);

      if (processedJob?.status === "done") {
        return Response.json({
          ok: true,
          message: `Invoice regenerated for order ${orderId}.`,
          orderId,
          status: "done",
          invoiceUrl,
          invoiceDownloadUrl,
        } satisfies ActionData);
      }

      if (!processedJob) {
        return Response.json({
          ok: true,
          message: `Regeneration job queued for order ${orderId}.`,
          orderId,
          status: "queued",
          invoiceUrl,
          invoiceDownloadUrl,
        } satisfies ActionData);
      }

      return Response.json({
        ok: true,
        message: `Regeneration result for order ${orderId}: ${processedJob.status}.`,
        orderId,
        status: processedJob.status,
        invoiceUrl,
        invoiceDownloadUrl,
      } satisfies ActionData);
    }

    return Response.json({ ok: false, error: "Unknown action" } satisfies ActionData, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown invoice action error";
    return Response.json({ ok: false, error: message } satisfies ActionData, { status: 400 });
  }
}

export default function InvoicePage() {
  const data = useLoaderData() as LoaderData;
  const actionData = useActionData() as ActionData | undefined;

  return (
    <div style={{ padding: 24, maxWidth: 1500, margin: "0 auto", display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>VAT Invoices</h1>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Fixed iHerb-style invoice template is active. Template editor is removed.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href="/app/invoice?previewLocale=en"
            style={{
              textDecoration: "none",
              border: data.previewLocale === "en" ? "2px solid #111827" : "1px solid #d1d5db",
              padding: "8px 12px",
              borderRadius: 8,
              color: "#111827",
              background: data.previewLocale === "en" ? "#f3f4f6" : "#fff",
            }}
          >
            Preview EN
          </a>
          <a
            href="/app/invoice?previewLocale=et"
            style={{
              textDecoration: "none",
              border: data.previewLocale === "et" ? "2px solid #111827" : "1px solid #d1d5db",
              padding: "8px 12px",
              borderRadius: 8,
              color: "#111827",
              background: data.previewLocale === "et" ? "#f3f4f6" : "#fff",
            }}
          >
            Preview ET
          </a>
        </div>
      </div>

      {actionData && "error" in actionData ? (
        <div style={{ background: "#fee2e2", color: "#7f1d1d", borderRadius: 10, padding: "10px 12px" }}>
          {actionData.error}
        </div>
      ) : null}
      {actionData?.ok ? (
        <div style={{ background: "#dcfce7", color: "#14532d", borderRadius: 10, padding: "10px 12px" }}>
          {actionData.message}
        </div>
      ) : null}
      {actionData?.ok && actionData.invoiceUrl ? (
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 16 }}>
          <h2 style={{ margin: "0 0 10px" }}>Invoice PDF</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a
              href={actionData.invoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: "none",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "#fff",
                color: "#111827",
                fontWeight: 600,
              }}
            >
              Open PDF
            </a>
            <a
              href={actionData.invoiceDownloadUrl || actionData.invoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: "none",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #111827",
                background: "#111827",
                color: "#fff",
                fontWeight: 700,
              }}
            >
              Download PDF
            </a>
          </div>
        </section>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 16 }}>
          <h2 style={{ margin: "0 0 12px" }}>Automation Settings</h2>
          <Form method="post" style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="intent" value="save_settings" />
            <input type="hidden" name="previewLocale" value={data.previewLocale} />

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="enabled" defaultChecked={data.settings.enabled} />
              Enable invoice automation (orders/create)
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span>Default invoice locale</span>
              <select name="defaultLocale" defaultValue={data.settings.defaultLocale} style={{ padding: 10 }}>
                <option value="en">English (en)</option>
                <option value="et">Estonian (et)</option>
              </select>
            </label>

            <button type="submit" style={{ padding: "10px 14px", fontWeight: 700 }}>
              Save settings
            </button>
          </Form>
        </section>

        <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 16 }}>
          <h2 style={{ margin: "0 0 10px" }}>Language Mapping</h2>
          <p style={{ margin: "0 0 12px", color: "#6b7280" }}>
            Map storefront language to invoice locale. Template selection is removed.
          </p>

          <div style={{ display: "grid", gap: 8 }}>
            {data.mappings.map((mapping) => {
              const languageOptions = mergeLocaleOptions(data.storefrontLocales, mapping.storefrontLang);
              return (
                <div
                  key={mapping.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.3fr 0.8fr auto auto",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <Form method="post" style={{ display: "contents" }}>
                    <input type="hidden" name="intent" value="upsert_mapping" />
                    <input type="hidden" name="previewLocale" value={data.previewLocale} />
                    <select name="storefrontLang" defaultValue={mapping.storefrontLang} style={{ padding: 10 }}>
                      {languageOptions.map((option) => (
                        <option key={option.locale} value={option.locale}>
                          {option.locale} - {option.name}
                          {option.primary ? " (primary)" : ""}
                        </option>
                      ))}
                    </select>
                    <select name="invoiceLocale" defaultValue={normalizeLocale(mapping.invoiceLocale)} style={{ padding: 10 }}>
                      <option value="en">en</option>
                      <option value="et">et</option>
                    </select>
                    <button type="submit" style={{ padding: "10px 12px" }}>
                      Save
                    </button>
                  </Form>

                  <Form method="post">
                    <input type="hidden" name="intent" value="delete_mapping" />
                    <input type="hidden" name="previewLocale" value={data.previewLocale} />
                    <input type="hidden" name="mappingId" value={mapping.id} />
                    <button type="submit" style={{ padding: "10px 12px" }}>
                      Delete
                    </button>
                  </Form>
                </div>
              );
            })}

            <Form
              method="post"
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid #e5e7eb",
                display: "grid",
                gridTemplateColumns: "1.3fr 0.8fr auto",
                gap: 8,
                alignItems: "center",
              }}
            >
              <input type="hidden" name="intent" value="upsert_mapping" />
              <input type="hidden" name="previewLocale" value={data.previewLocale} />
              <select name="storefrontLang" defaultValue={data.storefrontLocales[0]?.locale || "en"} style={{ padding: 10 }}>
                {data.storefrontLocales.map((option) => (
                  <option key={option.locale} value={option.locale}>
                    {option.locale} - {option.name}
                    {option.primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
              <select name="invoiceLocale" defaultValue="en" style={{ padding: 10 }}>
                <option value="en">en</option>
                <option value="et">et</option>
              </select>
              <button type="submit" style={{ padding: "10px 12px" }}>
                Add mapping
              </button>
            </Form>
          </div>
        </section>
      </div>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 16 }}>
        <h2 style={{ margin: "0 0 10px" }}>Regenerate Invoice</h2>
        <p style={{ margin: "0 0 12px", color: "#6b7280" }}>
          Use this to regenerate an invoice for an existing order and send the updated PDF again.
        </p>
        <Form method="post" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
          <input type="hidden" name="intent" value="regenerate_order_invoice" />
          <input type="hidden" name="previewLocale" value={data.previewLocale} />
          <input
            name="orderRef"
            placeholder="Order number or ID (example: #717313138 or 717313138)"
            style={{ padding: 10 }}
            required
          />
          <button type="submit" style={{ padding: "10px 14px", fontWeight: 700 }}>
            Regenerate now
          </button>
        </Form>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Fixed Invoice Preview</h2>
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            Invoice number = order number (example: <strong>#717313138</strong>)
          </div>
        </div>

        <div style={{ border: "1px solid #d1d5db", borderRadius: 12, overflow: "hidden", background: "#f3f4f6" }}>
          <iframe
            title="fixed-invoice-pdf-preview"
            src={data.previewPdfDataUrl}
            style={{ width: "100%", minHeight: 1150, border: 0, background: "#fff" }}
          />
        </div>
      </section>
    </div>
  );
}
