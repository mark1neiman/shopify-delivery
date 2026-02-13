import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import db from "../db.server";
import { adminGraphql } from "../shipping.server";
import {
  claimQueuedInvoiceJobByOrderId,
  claimNextQueuedInvoiceJob,
  markInvoiceJobDone,
  markInvoiceJobFailed,
  markInvoiceJobSkipped,
  normalizeLocale,
  normalizeOrderId,
} from "./invoice-jobs.server";
import { getInvoiceSettings, resolveInvoiceLocale, type InvoiceSettingsRecord } from "./invoice-settings.server";
import { sendInvoiceEmailWithAttachment } from "./invoice-email.server";
import { generateInvoicePdf } from "./invoice-pdf.server";
import { createInvoiceAccessToken } from "./invoice-access.server";

type InvoiceLocale = "en" | "et";
type AdminGraphqlClient = Parameters<typeof adminGraphql>[0];

type InvoiceTemplateSource = {
  locale: InvoiceLocale;
  templateId: string | null;
  templateVersionId: string | null;
  templateName: string;
  html: string;
  css: string;
};

type InvoiceMoney = {
  amount: string | null;
  currencyCode: string | null;
};

type InvoiceAddress = {
  name: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
  country: string;
  countryCode: string;
  phone: string;
};

type InvoiceOrderLineItem = {
  title: string;
  sku: string;
  variantTitle: string;
  quantity: number;
  originalUnitPrice: InvoiceMoney;
  discountedTotal: InvoiceMoney;
};

type InvoiceOrderData = {
  id: string;
  orderIdNumeric: string;
  name: string;
  email: string;
  createdAt: string;
  currencyCode: string;
  note: string;
  customerName: string;
  customerEmail: string;
  billingAddress: InvoiceAddress | null;
  shippingAddress: InvoiceAddress | null;
  shippingTitle: string;
  paymentGatewayNames: string[];
  customAttributes: Array<{ key: string; value: string }>;
  subtotal: InvoiceMoney;
  totalTax: InvoiceMoney;
  totalShipping: InvoiceMoney;
  totalDiscounts: InvoiceMoney;
  total: InvoiceMoney;
  lineItems: InvoiceOrderLineItem[];
};

type InvoiceSellerProfile = {
  name: string;
  addressLines: string[];
  vatId: string;
  registrationId: string;
  email: string;
  phone: string;
  website: string;
  logoUrl: string;
};

type ShopBranding = {
  shopName: string;
  shopEmail: string;
  shopUrl: string;
  logoUrl: string;
};

type InvoiceLabels = {
  invoiceTitle: string;
  topCaption: string;
  printLabel: string;
  orderNumber: string;
  dateOfOrder: string;
  shippingAddress: string;
  billingAddress: string;
  orderTotals: string;
  payment: string;
  trackingInfo: string;
  contactInformation: string;
  webLabel: string;
  emailLabel: string;
  disclaimerTitle: string;
  returnPolicyTitle: string;
  extraDiscounts: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxPointDate: string;
  currency: string;
  order: string;
  supplier: string;
  billingTo: string;
  shippingTo: string;
  customerEmail: string;
  paymentMethod: string;
  shippingMethod: string;
  itemNo: string;
  item: string;
  sku: string;
  qty: string;
  unitPrice: string;
  discount: string;
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  vatId: string;
  registrationId: string;
  noItems: string;
};

export type ProcessInvoiceJobsInput = {
  admin: AdminGraphqlClient;
  shop: string;
  limit?: number;
  lockOwner?: string;
  preferredOrderId?: string;
};

export type ProcessInvoiceJobsResult = {
  shop: string;
  lockOwner: string;
  requestedLimit: number;
  processed: number;
  done: number;
  skipped: number;
  failed: number;
  jobs: Array<{
    jobId: string;
    orderId: string;
    locale: InvoiceLocale | null;
    status: "done" | "skipped" | "failed";
    invoiceDocumentId?: string;
    reason?: string;
  }>;
};

const ORDER_QUERY = `#graphql
query InvoiceOrder($id: ID!) {
  order(id: $id) {
    id
    name
    email
    createdAt
    currencyCode
    note
    paymentGatewayNames
    customer {
      displayName
      firstName
      lastName
      email
    }
    billingAddress {
      name
      firstName
      lastName
      company
      address1
      address2
      city
      province
      zip
      country
      countryCodeV2
      phone
    }
    shippingAddress {
      name
      firstName
      lastName
      company
      address1
      address2
      city
      province
      zip
      country
      countryCodeV2
      phone
    }
    customAttributes {
      key
      value
    }
    subtotalPriceSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    totalTaxSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    totalShippingPriceSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    totalDiscountsSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    totalPriceSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    shippingLines(first: 20) {
      nodes {
        title
      }
    }
    lineItems(first: 250) {
      nodes {
        title
        sku
        variantTitle
        quantity
        originalUnitPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        discountedTotalSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }
    }
  }
}`;

const SHOP_BRANDING_QUERY = `#graphql
query InvoiceShopBranding {
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
}`;

const ORDER_METAFIELDS_SET_MUTATION = `#graphql
mutation InvoiceSetOrderMetafield($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      namespace
      key
      value
    }
    userErrors {
      field
      message
    }
  }
}`;

const ORDER_INVOICE_METAFIELD_NAMESPACE = "custom";
const ORDER_INVOICE_METAFIELD_KEY = "vat_invoice_url";
const ORDER_INVOICE_METAFIELD_NAME = "VAT Invoice PDF";
const ORDER_INVOICE_METAFIELD_DESCRIPTION = "Public link to generated VAT invoice PDF.";

const ORDER_INVOICE_METAFIELD_DEFINITION_QUERY = `#graphql
query InvoiceOrderMetafieldDefinition($namespace: String!, $key: String!) {
  metafieldDefinitions(first: 1, ownerType: ORDER, namespace: $namespace, key: $key) {
    edges {
      node {
        id
      }
    }
  }
}`;

const ORDER_INVOICE_METAFIELD_DEFINITION_CREATE_MUTATION = `#graphql
mutation InvoiceCreateOrderMetafieldDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}`;

const ORDER_INVOICE_METAFIELD_DEFINITION_PIN_MUTATION = `#graphql
mutation InvoicePinOrderMetafieldDefinition($definitionId: ID!) {
  metafieldDefinitionPin(definitionId: $definitionId) {
    pinnedDefinition {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}`;

const ensuredOrderInvoiceMetafieldShops = new Set<string>();

const DEFAULT_TEMPLATE_CSS = `
body { font-family: Arial, sans-serif; color: #111; font-size: 12px; margin: 0; padding: 22px; }
.invoice-page { max-width: 920px; margin: 0 auto; }
.receipt-top { display: flex; justify-content: space-between; gap: 10px; color: #666; font-size: 12px; margin-bottom: 16px; }
.brand-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
.brand-identity { display: flex; align-items: center; gap: 14px; }
.seller-logo { max-height: 64px; width: auto; object-fit: contain; display: block; }
.seller-logo[src=""] { display: none; }
.brand-name { font-size: 42px; font-weight: 700; color: #4f8a10; line-height: 1; }
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

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toInvoiceLocale(value: unknown): InvoiceLocale {
  const normalized = normalizeLocale(value);
  return normalized.startsWith("et") ? "et" : "en";
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    return lowered === "true" || lowered === "1" || lowered === "yes";
  }
  return false;
}

function parseJson(input: string | null): unknown {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function detectStorefrontLocale(payload: unknown): string {
  const payloadObject = asObject(payload);
  const clientDetails = asObject(payloadObject?.client_details);
  if (!payloadObject) return "";
  return (
    asString(payloadObject.customer_locale) ||
    asString(payloadObject.locale) ||
    asString(payloadObject.buyer_locale) ||
    asString(clientDetails?.accept_language)
  );
}

function compact(parts: string[]): string[] {
  return parts.map((part) => part.trim()).filter(Boolean);
}

function toMoney(value: unknown): InvoiceMoney {
  const moneyObject = asObject(value);
  const shopMoney = asObject(moneyObject?.shopMoney);
  return {
    amount: asString(shopMoney?.amount) || null,
    currencyCode: asString(shopMoney?.currencyCode) || null,
  };
}

function moneyAmount(value: InvoiceMoney): number {
  const amount = Number.parseFloat(asString(value.amount));
  if (!Number.isFinite(amount)) return 0;
  return amount;
}

function moneyFromNumber(amount: number, currencyCode: string): InvoiceMoney {
  return {
    amount: Number.isFinite(amount) ? amount.toFixed(2) : "0.00",
    currencyCode: currencyCode || "EUR",
  };
}

function toAddress(value: unknown): InvoiceAddress | null {
  const addressObject = asObject(value);
  if (!addressObject) return null;
  return {
    name:
      asString(addressObject.name) ||
      `${asString(addressObject.firstName)} ${asString(addressObject.lastName)}`.trim(),
    company: asString(addressObject.company),
    address1: asString(addressObject.address1),
    address2: asString(addressObject.address2),
    city: asString(addressObject.city),
    province: asString(addressObject.province),
    zip: asString(addressObject.zip),
    country: asString(addressObject.country),
    countryCode: asString(addressObject.countryCodeV2),
    phone: asString(addressObject.phone),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAddressLines(address: InvoiceAddress | null): string[] {
  if (!address) return [];
  return compact([
    address.name,
    address.company,
    address.address1,
    address.address2,
    compact([address.city, address.province, address.zip]).join(", "),
    address.country,
    address.phone,
  ]);
}

function formatAddressSingleLine(address: InvoiceAddress | null): string {
  return formatAddressLines(address).join(", ");
}

function formatAddressHtml(address: InvoiceAddress | null): string {
  return formatAddressLines(address)
    .map((line) => escapeHtml(line))
    .join("<br />");
}

function formatDate(value: string, locale: InvoiceLocale): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const intlLocale = locale === "et" ? "et-EE" : "en-GB";
  return new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatMoney(money: InvoiceMoney, fallbackCurrency: string, locale: InvoiceLocale): string {
  const currency = asString(money.currencyCode) || fallbackCurrency || "EUR";
  const amountRaw = asString(money.amount);
  if (!amountRaw) return "";

  const amount = Number.parseFloat(amountRaw);
  if (!Number.isFinite(amount)) {
    return `${amountRaw} ${currency}`.trim();
  }

  const intlLocale = locale === "et" ? "et-EE" : "en-GB";
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
  }).format(amount);
}

function invoiceLabels(locale: InvoiceLocale): InvoiceLabels {
  if (locale === "et") {
    return {
      invoiceTitle: "Arve",
      topCaption: "Kviitung",
      printLabel: "Prindi",
      orderNumber: "Tellimuse number",
      dateOfOrder: "Tellimuse kuupaev",
      shippingAddress: "Tarneaadress",
      billingAddress: "Arveldusaadress",
      orderTotals: "Tellimuse summad",
      payment: "Makse",
      trackingInfo: "Tarneviis / Jalgimine",
      contactInformation: "Kontaktandmed",
      webLabel: "Veeb",
      emailLabel: "Email",
      disclaimerTitle: "Marge",
      returnPolicyTitle: "Tagastusreeglid",
      extraDiscounts: "Lisallahindlused",
      invoiceNumber: "Arve number",
      invoiceDate: "Kuupaev",
      taxPointDate: "Maksustamise kuupaev",
      currency: "Valuuta",
      order: "Tellimus",
      supplier: "Muua",
      billingTo: "Arve saaja",
      shippingTo: "Tarne aadress",
      customerEmail: "Kliendi email",
      paymentMethod: "Makseviis",
      shippingMethod: "Tarneviis",
      itemNo: "#",
      item: "Toode",
      sku: "SKU",
      qty: "Kogus",
      unitPrice: "Uhiku hind",
      discount: "Allahindlus",
      subtotal: "Vahesumma",
      shipping: "Tarne",
      tax: "KM",
      total: "Kokku",
      vatId: "KMKR",
      registrationId: "Registrikood",
      noItems: "Tooted puuduvad",
    };
  }

  return {
    invoiceTitle: "Invoice",
    topCaption: "Receipt",
    printLabel: "Print",
    orderNumber: "Order Number",
    dateOfOrder: "Date of Order",
    shippingAddress: "Shipping Address",
    billingAddress: "Billing Address",
    orderTotals: "Order Totals",
    payment: "Payment",
    trackingInfo: "Shipping Method / Tracking Info",
    contactInformation: "Contact Information",
    webLabel: "Web",
    emailLabel: "Email",
    disclaimerTitle: "Disclaimer",
    returnPolicyTitle: "Return Policy",
    extraDiscounts: "Extra Discounts",
    invoiceNumber: "Invoice Number",
    invoiceDate: "Invoice Date",
    taxPointDate: "Tax Point Date",
    currency: "Currency",
    order: "Order",
    supplier: "Supplier",
    billingTo: "Billing To",
    shippingTo: "Shipping To",
    customerEmail: "Customer Email",
    paymentMethod: "Payment Method",
    shippingMethod: "Shipping Method",
    itemNo: "#",
    item: "Item",
    sku: "SKU",
    qty: "Qty.",
    unitPrice: "Price",
    discount: "Discount",
    subtotal: "Subtotal",
    shipping: "Shipping",
    tax: "VAT",
    total: "Order Total",
    vatId: "VAT ID",
    registrationId: "Reg. No.",
    noItems: "No items",
  };
}

function normalizePathSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "na";
}

function formatSellerAddressHtml(lines: string[]): string {
  return lines.map((line) => escapeHtml(line)).join("<br />");
}

function resolveSellerProfile(
  shop: string,
  settings: InvoiceSettingsRecord | null,
  branding: ShopBranding | null,
): InvoiceSellerProfile {
  const line1 = asString(process.env.INVOICE_SELLER_ADDRESS_LINE1);
  const line2 = asString(process.env.INVOICE_SELLER_ADDRESS_LINE2);
  const line3 = asString(process.env.INVOICE_SELLER_ADDRESS_LINE3);
  const line4 = asString(process.env.INVOICE_SELLER_ADDRESS_LINE4);
  const city = asString(process.env.INVOICE_SELLER_CITY);
  const province = asString(process.env.INVOICE_SELLER_PROVINCE);
  const zip = asString(process.env.INVOICE_SELLER_POSTAL_CODE);
  const country = asString(process.env.INVOICE_SELLER_COUNTRY);

  const compoundCity = compact([city, province, zip]).join(", ");
  const addressLines = compact([line1, line2, line3, line4, compoundCity, country]);

  return {
    name:
      asString(process.env.INVOICE_SELLER_NAME) ||
      asString(settings?.fromName) ||
      asString(branding?.shopName) ||
      shop,
    addressLines,
    vatId: asString(process.env.INVOICE_SELLER_VAT_ID),
    registrationId: asString(process.env.INVOICE_SELLER_REGISTRATION_ID),
    email:
      asString(process.env.INVOICE_SELLER_EMAIL) ||
      asString(settings?.fromEmail) ||
      asString(branding?.shopEmail),
    phone: asString(process.env.INVOICE_SELLER_PHONE),
    website: asString(process.env.INVOICE_SELLER_WEBSITE) || asString(branding?.shopUrl),
    logoUrl: asString(process.env.INVOICE_SELLER_LOGO_URL) || asString(branding?.logoUrl),
  };
}

function vatLegalNote(order: InvoiceOrderData, locale: InvoiceLocale): string {
  const tax = moneyAmount(order.totalTax);
  const custom = asString(process.env.INVOICE_VAT_NOTE);
  if (custom) return custom;
  if (tax > 0) {
    return locale === "et"
      ? "KM on lisatud vastavalt kohalduvatele EL kaibemaksureeglitele."
      : "VAT is charged according to applicable EU VAT rules.";
  }
  return locale === "et"
    ? "KM summa on 0.00. Voib rakenduda vabastus voi reverse-charge."
    : "VAT amount is 0.00. Exemption or reverse-charge may apply.";
}

function invoiceNumber(order: InvoiceOrderData): string {
  const explicitOrderName = asString(order.name);
  if (explicitOrderName) return explicitOrderName;

  const numeric = asString(order.orderIdNumeric);
  if (!numeric) return "";
  return `#${numeric}`;
}

function sanitizeFilenamePart(value: string): string {
  return value
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code < 32) return "-";
      if (char === "<" || char === ">" || char === ":" || char === "\"" || char === "/" || char === "\\") return "-";
      if (char === "|" || char === "?" || char === "*") return "-";
      return char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function invoiceAttachmentFilename(invoiceNo: string, orderId: string): string {
  const base = sanitizeFilenamePart(asString(invoiceNo) || asString(orderId));
  const fallback = sanitizeFilenamePart(asString(orderId)) || "invoice";
  return `${base || fallback}.pdf`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

function resolveInvoiceDownloadBaseUrl(shop: string, branding: ShopBranding | null): string {
  const explicit = trimTrailingSlash(asString(process.env.INVOICE_PUBLIC_BASE_URL));
  if (explicit) return explicit;

  const storefront = trimTrailingSlash(asString(branding?.shopUrl));
  if (storefront) return `${storefront}/apps/checkout`;

  const myshopifyStorefront = asString(shop).toLowerCase();
  if (myshopifyStorefront) return `https://${myshopifyStorefront}/apps/checkout`;

  const appUrl = trimTrailingSlash(asString(process.env.SHOPIFY_APP_URL));
  if (appUrl) return `${appUrl}/apps/checkout`;
  return "";
}

function buildInvoiceDownloadUrl(params: {
  shop: string;
  branding: ShopBranding | null;
  documentId: string;
  storageKey: string;
}): string {
  const token = createInvoiceAccessToken({
    documentId: params.documentId,
    shop: params.shop,
    storageKey: params.storageKey,
  });
  if (!token) return "";
  const base = resolveInvoiceDownloadBaseUrl(params.shop, params.branding);
  const encodedDocumentId = encodeURIComponent(params.documentId);
  const encodedToken = encodeURIComponent(token);
  return `${base}/invoice/${encodedDocumentId}?t=${encodedToken}`;
}

function renderTokenTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_full, token: string) => tokens[token] ?? "");
}

function defaultTemplateHtml(locale: InvoiceLocale): string {
  const labels = invoiceLabels(locale);

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
          <p>${labels.vatId}: {{seller.vat_id}} | ${labels.registrationId}: {{seller.registration_id}}</p>
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

async function fetchOrderData(admin: AdminGraphqlClient, orderId: string): Promise<InvoiceOrderData | null> {
  const normalizedOrderId = normalizeOrderId(orderId);
  if (!normalizedOrderId) return null;

  const orderGid = `gid://shopify/Order/${normalizedOrderId}`;
  const response = await adminGraphql(admin, ORDER_QUERY, { variables: { id: orderGid } });
  const json = await response.json();
  const responseObject = asObject(json);
  const errors = Array.isArray(responseObject?.errors) ? responseObject.errors : [];
  const firstErrorObject = asObject(errors[0]);

  if (errors.length > 0) {
    const firstError = asString(firstErrorObject?.message) || "Shopify GraphQL order query failed";
    throw new Error(firstError);
  }

  const dataObject = asObject(responseObject?.data);
  const order = asObject(dataObject?.order);
  if (!order) return null;

  const customer = asObject(order.customer);
  const totalPriceSet = asObject(order.totalPriceSet);
  const totalPriceShopMoney = asObject(totalPriceSet?.shopMoney);
  const shippingLines = asObject(order.shippingLines);
  const shippingLineNodes = Array.isArray(shippingLines?.nodes) ? shippingLines.nodes : [];
  const firstShippingLine = asObject(shippingLineNodes[0]);
  const lineItemsConnection = asObject(order.lineItems);
  const lineItemNodes = Array.isArray(lineItemsConnection?.nodes) ? lineItemsConnection.nodes : [];
  const customAttributes = Array.isArray(order.customAttributes) ? order.customAttributes : [];
  const paymentGatewayNames = Array.isArray(order.paymentGatewayNames)
    ? order.paymentGatewayNames.map((entry) => asString(entry)).filter(Boolean)
    : [];

  const customerDisplayName = asString(customer?.displayName);
  const customerName =
    customerDisplayName || `${asString(customer?.firstName)} ${asString(customer?.lastName)}`.trim();

  return {
    id: asString(order.id),
    orderIdNumeric: normalizedOrderId,
    name: asString(order.name),
    email: asString(order.email),
    createdAt: asString(order.createdAt),
    currencyCode: asString(order.currencyCode) || asString(totalPriceShopMoney?.currencyCode) || "EUR",
    note: asString(order.note),
    customerName,
    customerEmail: asString(customer?.email),
    billingAddress: toAddress(order.billingAddress),
    shippingAddress: toAddress(order.shippingAddress),
    shippingTitle: asString(firstShippingLine?.title),
    paymentGatewayNames,
    customAttributes: customAttributes
      .map((attribute) => {
        const attributeObject = asObject(attribute);
        return {
          key: asString(attributeObject?.key),
          value: asString(attributeObject?.value),
        };
      })
      .filter((attribute: { key: string; value: string }) => attribute.key && attribute.value),
    subtotal: toMoney(order.subtotalPriceSet),
    totalTax: toMoney(order.totalTaxSet),
    totalShipping: toMoney(order.totalShippingPriceSet),
    totalDiscounts: toMoney(order.totalDiscountsSet),
    total: toMoney(order.totalPriceSet),
    lineItems: lineItemNodes.map((item) => {
      const itemObject = asObject(item);
      return {
        title: asString(itemObject?.title),
        sku: asString(itemObject?.sku),
        variantTitle: asString(itemObject?.variantTitle),
        quantity: Math.max(0, Number(itemObject?.quantity || 0)),
        originalUnitPrice: toMoney(itemObject?.originalUnitPriceSet),
        discountedTotal: toMoney(itemObject?.discountedTotalSet),
      };
    }),
  };
}

async function fetchShopBranding(admin: AdminGraphqlClient): Promise<ShopBranding | null> {
  try {
    const response = await adminGraphql(admin, SHOP_BRANDING_QUERY);
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

async function resolveTemplate(
  shop: string,
  locale: InvoiceLocale,
  storefrontLocale: string,
): Promise<InvoiceTemplateSource> {
  const normalizedShop = asString(shop);
  const normalizedStorefrontLocale = normalizeLocale(storefrontLocale);
  let effectiveLocale: InvoiceLocale = locale;

  if (normalizedShop && normalizedStorefrontLocale) {
    const mapped = await db.$queryRawUnsafe<{ invoiceLocale: string | null }[]>(
      `
      SELECT "invoiceLocale"
      FROM "InvoiceLocaleMapping"
      WHERE "shop" = ? AND "storefrontLang" = ?
      LIMIT 1
      `,
      normalizedShop,
      normalizedStorefrontLocale,
    );

    if (mapped?.[0]?.invoiceLocale) {
      effectiveLocale = toInvoiceLocale(mapped[0].invoiceLocale);
    }
  }

  return {
    locale: effectiveLocale,
    templateId: null,
    templateVersionId: "eu-fixed-v1",
    templateName: "builtin-eu-fixed",
    html: defaultTemplateHtml(effectiveLocale),
    css: DEFAULT_TEMPLATE_CSS,
  };
}

async function findOrderInvoiceMetafieldDefinitionId(admin: AdminGraphqlClient): Promise<string> {
  const response = await adminGraphql(admin, ORDER_INVOICE_METAFIELD_DEFINITION_QUERY, {
    variables: {
      namespace: ORDER_INVOICE_METAFIELD_NAMESPACE,
      key: ORDER_INVOICE_METAFIELD_KEY,
    },
  });

  const json = await response.json();
  const root = asObject(json);
  const rootErrors = Array.isArray(root?.errors) ? root.errors : [];
  if (rootErrors.length > 0) {
    const first = asObject(rootErrors[0]);
    const message = asString(first?.message) || "Shopify metafieldDefinitions query failed";
    throw new Error(message);
  }

  const data = asObject(root?.data);
  const definitions = asObject(data?.metafieldDefinitions);
  const edges = Array.isArray(definitions?.edges) ? definitions.edges : [];
  const firstEdge = asObject(edges[0]);
  const node = asObject(firstEdge?.node);
  return asString(node?.id);
}

async function createOrderInvoiceMetafieldDefinition(admin: AdminGraphqlClient): Promise<string> {
  const response = await adminGraphql(admin, ORDER_INVOICE_METAFIELD_DEFINITION_CREATE_MUTATION, {
    variables: {
      definition: {
        name: ORDER_INVOICE_METAFIELD_NAME,
        namespace: ORDER_INVOICE_METAFIELD_NAMESPACE,
        key: ORDER_INVOICE_METAFIELD_KEY,
        ownerType: "ORDER",
        description: ORDER_INVOICE_METAFIELD_DESCRIPTION,
        type: "url",
      },
    },
  });

  const json = await response.json();
  const root = asObject(json);
  const rootErrors = Array.isArray(root?.errors) ? root.errors : [];
  if (rootErrors.length > 0) {
    const first = asObject(rootErrors[0]);
    const message = asString(first?.message) || "Shopify metafieldDefinitionCreate failed";
    throw new Error(message);
  }

  const data = asObject(root?.data);
  const created = asObject(data?.metafieldDefinitionCreate);
  const userErrors = Array.isArray(created?.userErrors) ? created.userErrors : [];
  if (userErrors.length > 0) {
    const first = asObject(userErrors[0]);
    const message = asString(first?.message) || "metafieldDefinitionCreate user error";
    const lower = message.toLowerCase();
    if (lower.includes("already exists") || lower.includes("already taken")) {
      return "";
    }
    throw new Error(message);
  }

  const definition = asObject(created?.createdDefinition);
  return asString(definition?.id);
}

async function pinOrderInvoiceMetafieldDefinition(admin: AdminGraphqlClient, definitionId: string): Promise<void> {
  if (!definitionId) return;

  const response = await adminGraphql(admin, ORDER_INVOICE_METAFIELD_DEFINITION_PIN_MUTATION, {
    variables: { definitionId },
  });

  const json = await response.json();
  const root = asObject(json);
  const rootErrors = Array.isArray(root?.errors) ? root.errors : [];
  if (rootErrors.length > 0) {
    const first = asObject(rootErrors[0]);
    const message = asString(first?.message) || "Shopify metafieldDefinitionPin failed";
    throw new Error(message);
  }

  const data = asObject(root?.data);
  const pinResult = asObject(data?.metafieldDefinitionPin);
  const userErrors = Array.isArray(pinResult?.userErrors) ? pinResult.userErrors : [];
  if (userErrors.length > 0) {
    const first = asObject(userErrors[0]);
    const message = asString(first?.message) || "metafieldDefinitionPin user error";
    const lower = message.toLowerCase();
    if (lower.includes("already pinned")) return;
    throw new Error(message);
  }
}

async function ensureOrderInvoiceMetafieldDefinition(admin: AdminGraphqlClient, shop: string): Promise<void> {
  const shopKey = asString(shop).toLowerCase();
  if (!shopKey || ensuredOrderInvoiceMetafieldShops.has(shopKey)) {
    return;
  }

  let definitionId = await findOrderInvoiceMetafieldDefinitionId(admin);
  if (!definitionId) {
    definitionId = await createOrderInvoiceMetafieldDefinition(admin);
    if (!definitionId) {
      definitionId = await findOrderInvoiceMetafieldDefinitionId(admin);
    }
  }

  if (definitionId) {
    await pinOrderInvoiceMetafieldDefinition(admin, definitionId);
  }
  ensuredOrderInvoiceMetafieldShops.add(shopKey);
}

async function setOrderInvoiceUrlMetafield(
  admin: AdminGraphqlClient,
  shop: string,
  orderGid: string,
  invoiceUrl: string,
): Promise<void> {
  const ownerId = asString(orderGid);
  const value = asString(invoiceUrl);
  if (!ownerId || !value) return;

  try {
    await ensureOrderInvoiceMetafieldDefinition(admin, shop);
  } catch (error) {
    console.warn("[invoice] failed to ensure order invoice metafield definition", {
      shop,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const response = await adminGraphql(admin, ORDER_METAFIELDS_SET_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId,
          namespace: ORDER_INVOICE_METAFIELD_NAMESPACE,
          key: ORDER_INVOICE_METAFIELD_KEY,
          type: "url",
          value,
        },
      ],
    },
  });

  const json = await response.json();
  const root = asObject(json);
  const rootErrors = Array.isArray(root?.errors) ? root.errors : [];
  if (rootErrors.length > 0) {
    const first = asObject(rootErrors[0]);
    const message = asString(first?.message) || "Shopify metafieldsSet failed";
    throw new Error(message);
  }

  const data = asObject(root?.data);
  const metafieldsSet = asObject(data?.metafieldsSet);
  const userErrors = Array.isArray(metafieldsSet?.userErrors) ? metafieldsSet?.userErrors : [];
  if (userErrors.length > 0) {
    const first = asObject(userErrors[0]);
    const message = asString(first?.message) || "metafieldsSet user error";
    throw new Error(message);
  }
}

function buildItemsRows(order: InvoiceOrderData, locale: InvoiceLocale): string {
  const labels = invoiceLabels(locale);
  const totalsCurrency = order.currencyCode || "EUR";

  if (order.lineItems.length === 0) {
    return `<tr><td colspan="7">${escapeHtml(labels.noItems)}</td></tr>`;
  }

  return order.lineItems
    .map((item, index) => {
      const title = compact([item.title, item.variantTitle]).join(" - ");
      const unitAmount = moneyAmount(item.originalUnitPrice);
      const discountedAmount = moneyAmount(item.discountedTotal);
      const rawDiscount = Math.max(0, unitAmount * Math.max(item.quantity, 0) - discountedAmount);
      const discount = formatMoney(moneyFromNumber(rawDiscount, totalsCurrency), totalsCurrency, locale);
      const unitPrice = formatMoney(item.originalUnitPrice, totalsCurrency, locale);
      const subtotal = formatMoney(item.discountedTotal, totalsCurrency, locale);

      return [
        "<tr>",
        `<td class="num">${index + 1}</td>`,
        `<td>${escapeHtml(title)}</td>`,
        `<td>${escapeHtml(item.sku)}</td>`,
        `<td class="num">${escapeHtml(unitPrice)}</td>`,
        `<td class="num">${item.quantity}</td>`,
        `<td class="num">${escapeHtml(discount)}</td>`,
        `<td class="num">${escapeHtml(subtotal)}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");
}

function buildTemplateTokens(
  order: InvoiceOrderData,
  locale: InvoiceLocale,
  seller: InvoiceSellerProfile,
): Record<string, string> {
  const totalsCurrency = order.currencyCode || "EUR";
  const shippingMethod = asString(order.shippingTitle) || "-";
  const paymentMethod = asString(order.paymentGatewayNames[0]) || "-";
  const discountAmount = moneyAmount(order.totalDiscounts);
  const discountNote =
    asString(process.env.INVOICE_DISCOUNT_NOTE) ||
    (discountAmount > 0 ? "Extra discounts applied." : "No extra discounts applied.");
  const returnPolicyNote =
    asString(process.env.INVOICE_RETURN_POLICY_NOTE) ||
    "If you are unsatisfied with your order, please contact support to request return instructions.";

  const contactParts = compact([seller.email, seller.phone, seller.website]);
  const invoiceNo = invoiceNumber(order);

  const tokens: Record<string, string> = {
    "invoice.number": invoiceNo,
    "invoice.date": formatDate(order.createdAt, locale),
    "invoice.tax_point_date": formatDate(order.createdAt, locale),
    "currency.code": totalsCurrency,
    "order.id": order.orderIdNumeric,
    "order.name": order.name,
    "order.created_at": formatDate(order.createdAt, locale),
    "order.email": order.email,
    "order.note": order.note,
    "customer.name": order.customerName || order.billingAddress?.name || order.shippingAddress?.name || "",
    "customer.email": order.customerEmail || order.email,
    "billing.address": formatAddressSingleLine(order.billingAddress),
    "billing.address_html": formatAddressHtml(order.billingAddress),
    "shipping.title": shippingMethod,
    "shipping.address": formatAddressSingleLine(order.shippingAddress),
    "shipping.address_html": formatAddressHtml(order.shippingAddress),
    "payment.method": paymentMethod,
    "totals.subtotal": formatMoney(order.subtotal, totalsCurrency, locale),
    "totals.shipping": formatMoney(order.totalShipping, totalsCurrency, locale),
    "totals.tax": formatMoney(order.totalTax, totalsCurrency, locale),
    "totals.discounts": formatMoney(order.totalDiscounts, totalsCurrency, locale),
    "totals.total": formatMoney(order.total, totalsCurrency, locale),
    "seller.name": seller.name,
    "seller.address_html": formatSellerAddressHtml(seller.addressLines),
    "seller.vat_id": seller.vatId,
    "seller.registration_id": seller.registrationId,
    "seller.email": seller.email || "-",
    "seller.website": seller.website || "-",
    "seller.logo_url": seller.logoUrl || "",
    "seller.contact_line": contactParts.join(" | "),
    "legal.vat_note": vatLegalNote(order, locale),
    "legal.additional_note": discountNote,
    "legal.return_policy_note": returnPolicyNote,
  };

  for (const attribute of order.customAttributes) {
    const key = attribute.key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!key) continue;
    tokens[`order.attr_${key}`] = attribute.value;
  }

  return tokens;
}

function renderTemplate(
  source: InvoiceTemplateSource,
  tokens: Record<string, string>,
  rawTokens: Record<string, string>,
): string {
  const htmlWithCss = source.html.replace(/\{\{\s*template\.css\s*\}\}/g, source.css);

  return htmlWithCss.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_full, tokenName: string) => {
    const raw = rawTokens[tokenName];
    if (raw != null) return raw;
    const safeValue = tokens[tokenName];
    if (safeValue == null) return "";
    return escapeHtml(safeValue);
  });
}

async function upsertInvoiceDocument(params: {
  shop: string;
  orderId: string;
  orderName: string;
  orderEmail: string;
  locale: InvoiceLocale;
  checksum: string;
  template: InvoiceTemplateSource;
}) {
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  const storageType = "template";
  const storageKey = `${params.template.templateName}:${params.template.templateId || "builtin"}:${
    params.template.templateVersionId || "builtin"
  }`;

  await db.$executeRawUnsafe(
    `
    INSERT INTO "InvoiceDocument" (
      "id", "shop", "orderId", "orderName", "orderEmail", "locale",
      "status", "pdfStorageType", "pdfStorageKey", "pdfUrl", "checksum",
      "sentAt", "sentToEmail", "errorCode", "errorMessage", "createdAt", "updatedAt"
    )
    VALUES (?, ?, ?, ?, ?, ?, 'generated', ?, ?, NULL, ?, NULL, NULL, NULL, NULL, ?, ?)
    ON CONFLICT("shop", "orderId", "locale")
    DO UPDATE SET
      "orderName" = excluded."orderName",
      "orderEmail" = excluded."orderEmail",
      "status" = 'generated',
      "pdfStorageType" = excluded."pdfStorageType",
      "pdfStorageKey" = excluded."pdfStorageKey",
      "pdfUrl" = NULL,
      "checksum" = excluded."checksum",
      "sentAt" = NULL,
      "sentToEmail" = NULL,
      "errorCode" = NULL,
      "errorMessage" = NULL,
      "updatedAt" = excluded."updatedAt"
    `,
    id,
    params.shop,
    params.orderId,
    params.orderName || null,
    params.orderEmail || null,
    params.locale,
    storageType,
    storageKey,
    params.checksum,
    nowIso,
    nowIso,
  );

  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `
    SELECT "id"
    FROM "InvoiceDocument"
    WHERE "shop" = ? AND "orderId" = ? AND "locale" = ?
    LIMIT 1
    `,
    params.shop,
    params.orderId,
    params.locale,
  );

  return rows?.[0]?.id || id;
}

async function markInvoiceDocumentSent(params: {
  documentId: string;
  pdfStorageType: string;
  pdfStorageKey: string;
  pdfUrl: string | null;
  sentToEmail: string;
}) {
  const nowIso = new Date().toISOString();
  await db.$executeRawUnsafe(
    `
    UPDATE "InvoiceDocument"
    SET
      "status" = 'sent',
      "pdfStorageType" = ?,
      "pdfStorageKey" = ?,
      "pdfUrl" = ?,
      "sentAt" = ?,
      "sentToEmail" = ?,
      "errorCode" = NULL,
      "errorMessage" = NULL,
      "updatedAt" = ?
    WHERE "id" = ?
    `,
    params.pdfStorageType,
    params.pdfStorageKey,
    params.pdfUrl,
    nowIso,
    params.sentToEmail,
    nowIso,
    params.documentId,
  );
}

async function markInvoiceDocumentGenerated(params: {
  documentId: string;
  pdfStorageType: string;
  pdfStorageKey: string;
  pdfUrl: string | null;
}) {
  const nowIso = new Date().toISOString();
  await db.$executeRawUnsafe(
    `
    UPDATE "InvoiceDocument"
    SET
      "status" = 'generated',
      "pdfStorageType" = ?,
      "pdfStorageKey" = ?,
      "pdfUrl" = ?,
      "errorCode" = NULL,
      "errorMessage" = NULL,
      "updatedAt" = ?
    WHERE "id" = ?
    `,
    params.pdfStorageType,
    params.pdfStorageKey,
    params.pdfUrl,
    nowIso,
    params.documentId,
  );
}

async function markInvoiceDocumentFailed(documentId: string, errorCode: string, errorMessage: string) {
  const nowIso = new Date().toISOString();
  await db.$executeRawUnsafe(
    `
    UPDATE "InvoiceDocument"
    SET
      "status" = 'failed',
      "errorCode" = ?,
      "errorMessage" = ?,
      "updatedAt" = ?
    WHERE "id" = ?
    `,
    errorCode,
    errorMessage,
    nowIso,
    documentId,
  );
}

async function persistPdf(params: {
  shop: string;
  orderId: string;
  locale: InvoiceLocale;
  invoiceNumber: string;
  pdfBuffer: Buffer;
}): Promise<{ storageType: string; storageKey: string; absolutePath: string }> {
  const rootDir = asString(process.env.INVOICE_PDF_DIR) || "/tmp/shopify-delivery-invoices";
  const safeShop = normalizePathSegment(params.shop);
  const safeOrder = normalizePathSegment(params.orderId);
  const safeLocale = normalizePathSegment(params.locale);
  const filename = invoiceAttachmentFilename(params.invoiceNumber, params.orderId);
  const storageKey = `${safeShop}/${safeOrder}/${safeLocale}/${filename}`;
  const absolutePath = path.join(rootDir, storageKey);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, params.pdfBuffer);

  return {
    storageType: "local-file",
    storageKey,
    absolutePath,
  };
}

function resolveFromEnvelope(shop: string, seller: InvoiceSellerProfile, settings: InvoiceSettingsRecord | null) {
  const fromEmail =
    asString(settings?.fromEmail) ||
    asString(process.env.INVOICE_FROM_EMAIL) ||
    asString(seller.email) ||
    "no-reply@example.com";

  return {
    fromEmail,
    fromName: asString(settings?.fromName) || asString(seller.name) || shop,
    replyToEmail: asString(settings?.replyToEmail) || asString(seller.email) || null,
  };
}

function isInvoiceCustomerEmailEnabled(): boolean {
  const raw = asString(process.env.INVOICE_SEND_CUSTOMER_EMAIL);
  if (!raw) return true;
  return toBoolean(raw);
}

function resolveInvoiceEmailLogoUrl(): string {
  const explicit = asString(process.env.INVOICE_EMAIL_LOGO_URL);
  if (explicit) return explicit;
  const appUrl = trimTrailingSlash(asString(process.env.SHOPIFY_APP_URL));
  if (appUrl) return `${appUrl}/images/nana-logo.png`;
  return "https://delivery.nanails.eu/images/nana-logo.png";
}

function getOrderCustomAttributeValue(order: InvoiceOrderData, key: string): string {
  const targetKey = asString(key).toLowerCase();
  if (!targetKey) return "";
  for (const attribute of order.customAttributes || []) {
    if (asString(attribute.key).toLowerCase() === targetKey) {
      return asString(attribute.value);
    }
  }
  return "";
}

function parseAttributeAmount(value: string): number {
  const raw = asString(value);
  if (!raw) return 0;
  const normalized = raw.replace(",", ".").replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function buildEmailMessage(params: {
  locale: InvoiceLocale;
  shop: string;
  order: InvoiceOrderData;
  seller: InvoiceSellerProfile;
  settings: InvoiceSettingsRecord | null;
  invoiceUrl?: string;
}): { subject: string; body: string; html: string } {
  const invoiceNo = invoiceNumber(params.order);
  const logoUrl = resolveInvoiceEmailLogoUrl();
  const brandText = asString(process.env.INVOICE_BRAND_TEXT) || "NANAILS.EU";
  const memberDiscountAppliedRaw = getOrderCustomAttributeValue(params.order, "itella_member_discount_applied");
  const memberDiscountPercentRaw = getOrderCustomAttributeValue(params.order, "itella_member_discount_percent");
  const memberDiscountApplied =
    ["true", "1", "yes"].includes(memberDiscountAppliedRaw.toLowerCase()) || Boolean(memberDiscountPercentRaw);
  const memberDiscountPercent = memberDiscountPercentRaw || (memberDiscountApplied ? "15" : "");

  const tokens: Record<string, string> = {
    "shop.name": params.shop,
    "seller.name": params.seller.name,
    "order.name": params.order.name,
    "order.id": params.order.orderIdNumeric,
    "order.date": formatDate(params.order.createdAt, params.locale),
    "invoice.number": invoiceNo,
    "invoice.date": formatDate(params.order.createdAt, params.locale),
    "totals.total": formatMoney(params.order.total, params.order.currencyCode || "EUR", params.locale),
    "invoice.url": asString(params.invoiceUrl),
  };

  const defaultSubject =
    params.locale === "et"
      ? "Teie VAT arve PDF on lisatud"
      : "Your VAT invoice PDF is attached";

  const defaultBody =
    params.locale === "et"
      ? [
          "Teie VAT arve on valmis.",
          "",
          "PDF fail on kirjale lisatud.",
          ...(memberDiscountApplied
            ? [`Kliendisoodustus: ${memberDiscountPercent}% rakendus teie NANAILS.EU kontole.`]
            : []),
          `Arve number: ${invoiceNo}`,
          ...(asString(params.invoiceUrl) ? [`Arve allalaadimine: ${asString(params.invoiceUrl)}`] : []),
          `Muua: ${params.seller.name || params.shop}`,
          "",
          "Lugupidamisega",
          params.seller.name || params.shop,
        ].join("\n")
      : [
          "Your VAT invoice is ready.",
          "",
          "The PDF file is attached to this email.",
          ...(memberDiscountApplied
            ? [`Member discount: ${memberDiscountPercent}% was applied for your NANAILS.EU customer account.`]
            : []),
          `Invoice number: ${invoiceNo}`,
          ...(asString(params.invoiceUrl) ? [`Invoice download link: ${asString(params.invoiceUrl)}`] : []),
          `Supplier: ${params.seller.name || params.shop}`,
          "",
          "Regards,",
          params.seller.name || params.shop,
        ].join("\n");

  const subjectTemplate =
    (params.locale === "et" ? asString(params.settings?.emailSubjectEt) : asString(params.settings?.emailSubjectEn)) ||
    defaultSubject;
  const bodyTemplate =
    (params.locale === "et" ? asString(params.settings?.emailBodyEt) : asString(params.settings?.emailBodyEn)) ||
    defaultBody;
  const invoiceUrl = asString(params.invoiceUrl);
  const emailHeading = params.locale === "et" ? "Teie VAT arve PDF on valmis" : "Your VAT invoice PDF is ready";
  const emailSubText =
    params.locale === "et"
      ? "Aitah! Arve PDF on selle kirjaga kaasas."
      : "Thank you. Your invoice PDF is attached to this email.";
  const openLabel = params.locale === "et" ? "Ava arve veebis" : "Open invoice in browser";
  const footerText =
    params.locale === "et"
      ? `Kui PDF ei avane, kasutage seda linki: ${invoiceUrl}`
      : `If your PDF does not open, use this link: ${invoiceUrl}`;
  const safeSellerName = escapeHtml(params.seller.name || params.shop);
  const safeLogoUrl = escapeHtml(logoUrl);
  const safeBrandText = escapeHtml(brandText);
  const safeHeading = escapeHtml(emailHeading);
  const safeSubText = escapeHtml(emailSubText);
  const safeOpenLabel = escapeHtml(openLabel);
  const safeInvoiceUrl = escapeHtml(invoiceUrl);
  const safeFooterText = escapeHtml(footerText);
  const memberDiscountLabel =
    params.locale === "et"
      ? `${memberDiscountPercent}% kliendisoodustus rakendus teie tellimusele`
      : `${memberDiscountPercent}% member discount was applied to your order`;
  const safeMemberDiscountLabel = escapeHtml(memberDiscountLabel);
  const html = [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#efefef;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efefef;padding:18px 8px;">',
    '<tr><td align="center">',
    '<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:620px;max-width:620px;background:#ffffff;border:1px solid #dddddd;border-collapse:collapse;">',
    '<tr><td style="height:4px;background:#2f8f2f;"></td></tr>',
    '<tr><td style="padding:18px 24px 4px;font-family:Arial,sans-serif;font-size:24px;line-height:28px;font-weight:700;color:#2f8f2f;">' +
      safeBrandText +
      "</td></tr>",
    logoUrl
      ? '<tr><td style="padding:4px 24px 12px;">' +
        '<img src="' +
        safeLogoUrl +
        '" alt="' +
        safeSellerName +
        '" width="130" style="display:block;border:0;outline:none;text-decoration:none;height:auto;">' +
        "</td></tr>"
      : "",
    '<tr><td style="padding:0 24px 12px;">',
    '<div style="height:1px;background:#dcdcdc;line-height:1px;font-size:0;"></div>',
    "</td></tr>",
    '<tr><td style="padding:0 24px 10px;font-family:Arial,sans-serif;font-size:34px;line-height:38px;font-weight:700;color:#131313;">' +
      safeHeading +
      "</td></tr>",
    '<tr><td style="padding:0 24px 18px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#222222;">' +
      safeSubText +
      "</td></tr>",
    memberDiscountApplied
      ? '<tr><td style="padding:0 24px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3fbf3;border:1px solid #cfe7cf;border-radius:4px;"><tr><td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#1f5f1f;font-weight:700;">' +
        safeMemberDiscountLabel +
        "</td></tr></table></td></tr>"
      : "",
    '<tr><td style="padding:0 24px;"><div style="height:1px;background:#1f1f1f;line-height:1px;font-size:0;"></div></td></tr>',
    '<tr><td style="padding:18px 24px 8px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#222222;">PDF: <strong>' +
      escapeHtml(invoiceNo) +
      "</strong></td></tr>",
    invoiceUrl
      ? '<tr><td style="padding:8px 24px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:#2f8f2f;border-radius:4px;"><a href="' +
        safeInvoiceUrl +
        '" target="_blank" style="display:block;padding:12px 14px;font-family:Arial,sans-serif;font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;">' +
        safeOpenLabel +
        "</a></td></tr></table></td></tr>"
      : "",
    invoiceUrl
      ? '<tr><td style="padding:0 24px 20px;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#555555;">' +
        safeFooterText +
        "</td></tr>"
      : "",
    '<tr><td style="padding:10px 24px 22px;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#555555;">' +
      safeSellerName +
      "</td></tr>",
    "</table>",
    "</td></tr></table></body></html>",
  ].join("");

  return {
    subject: renderTokenTemplate(subjectTemplate, tokens),
    body: renderTokenTemplate(bodyTemplate, tokens),
    html,
  };
}

function buildPdfBuffer(order: InvoiceOrderData, locale: InvoiceLocale, seller: InvoiceSellerProfile): Buffer {
  const labels = invoiceLabels(locale);
  const currency = order.currencyCode || "EUR";
  const invNo = invoiceNumber(order);

  const items = order.lineItems.map((item, index) => {
    const unitAmount = moneyAmount(item.originalUnitPrice);
    const subtotalAmount = moneyAmount(item.discountedTotal);
    const discountAmount = Math.max(0, unitAmount * Math.max(item.quantity, 0) - subtotalAmount);

    return {
      index: index + 1,
      description: compact([item.title, item.variantTitle]).join(" - "),
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: formatMoney(item.originalUnitPrice, currency, locale),
      discount: formatMoney(moneyFromNumber(discountAmount, currency), currency, locale),
      subtotal: formatMoney(item.discountedTotal, currency, locale),
    };
  });

  const orderDiscountAmount = moneyAmount(order.totalDiscounts);
  const memberDiscountAmount = parseAttributeAmount(getOrderCustomAttributeValue(order, "itella_member_discount_amount"));
  const memberDiscountPercent =
    asString(getOrderCustomAttributeValue(order, "itella_member_discount_percent")) || "15";
  const campaignLabels = asString(getOrderCustomAttributeValue(order, "itella_campaign_labels"));
  const campaignDiscountAmount = parseAttributeAmount(getOrderCustomAttributeValue(order, "itella_campaign_discount_amount"));
  const promoCode =
    asString(getOrderCustomAttributeValue(order, "itella_promo_code")) ||
    asString(getOrderCustomAttributeValue(order, "promo_code"));
  const promoDiscountAmount = parseAttributeAmount(getOrderCustomAttributeValue(order, "itella_promo_discount_amount"));
  const giftItemsCount = Math.max(
    0,
    Number.parseInt(asString(getOrderCustomAttributeValue(order, "itella_gift_items_count")), 10) || 0,
  );
  const composedDiscountAmount = memberDiscountAmount + campaignDiscountAmount + promoDiscountAmount;
  const effectiveDiscountAmount = Math.max(orderDiscountAmount, composedDiscountAmount);
  const effectiveDiscountMoney = moneyFromNumber(effectiveDiscountAmount, currency);
  const discountDetails: string[] = [];
  if (memberDiscountAmount > 0) {
    discountDetails.push(
      `Member ${memberDiscountPercent}%: ${formatMoney(moneyFromNumber(memberDiscountAmount, currency), currency, locale)}`,
    );
  }
  if (campaignLabels) {
    const suffix =
      campaignDiscountAmount > 0
        ? ` (${formatMoney(moneyFromNumber(campaignDiscountAmount, currency), currency, locale)})`
        : "";
    discountDetails.push(`Campaigns: ${campaignLabels}${suffix}`);
  }
  if (promoCode) {
    const suffix =
      promoDiscountAmount > 0
        ? ` (${formatMoney(moneyFromNumber(promoDiscountAmount, currency), currency, locale)})`
        : "";
    discountDetails.push(`Promo: ${promoCode}${suffix}`);
  }
  if (giftItemsCount > 0) {
    discountDetails.push(`Gift items: ${giftItemsCount}`);
  }

  const summaryRows = [
    { label: labels.subtotal, value: formatMoney(order.subtotal, currency, locale) },
    { label: labels.shipping, value: formatMoney(order.totalShipping, currency, locale) },
    { label: labels.tax, value: formatMoney(order.totalTax, currency, locale) },
    { label: labels.discount, value: formatMoney(effectiveDiscountMoney, currency, locale) },
    { label: labels.total, value: formatMoney(order.total, currency, locale), strong: true },
  ];

  const sellerWebsite = asString(seller.website) || "-";
  const sellerEmail = asString(seller.email) || "-";
  const sellerContactLine = `${sellerWebsite} | ${sellerEmail}`;
  const billingLines = formatAddressLines(order.billingAddress);
  const shippingLines = formatAddressLines(order.shippingAddress);
  const customerName = order.customerName || order.billingAddress?.name || order.shippingAddress?.name || "";
  const paymentMethod = asString(order.paymentGatewayNames[0]) || "-";
  const shippingMethod = order.shippingTitle || "-";
  const discountNote =
    asString(process.env.INVOICE_DISCOUNT_NOTE) ||
    (discountDetails.length > 0
      ? discountDetails.join(" | ")
      : effectiveDiscountAmount > 0
        ? "Extra discounts applied."
        : "No extra discounts applied.");
  const returnPolicyNote =
    asString(process.env.INVOICE_RETURN_POLICY_NOTE) ||
    "If you are unsatisfied with your order, please contact support to request return instructions.";
  const pdfSellerName = (asString(process.env.INVOICE_PDF_SELLER_NAME) || "NANAILS.EU").toUpperCase();

  return generateInvoicePdf({
    topDate: formatDate(order.createdAt, locale),
    topCaption: `${labels.topCaption} - ${pdfSellerName}`,
    printLabel: labels.printLabel,
    sellerName: pdfSellerName,
    brandContactLine: sellerContactLine,
    orderMetaLeft: `${labels.orderNumber}. ${invNo}`,
    orderMetaRight: `${labels.dateOfOrder}. ${formatDate(order.createdAt, locale)}`,
    shipping: {
      title: `${labels.shippingAddress}:`,
      lines: shippingLines,
    },
    billing: {
      title: `${labels.billingAddress}:`,
      lines: compact([customerName, ...billingLines]),
    },
    totalsTitle: `${labels.orderTotals}:`,
    totalsRows: summaryRows,
    paymentTitle: `${labels.payment}:`,
    paymentMethod,
    trackingLabel: labels.trackingInfo,
    shippingMethod,
    vatRegistrationLine: `${labels.vatId}: ${seller.vatId || "-"} | ${labels.registrationId}: ${
      seller.registrationId || "-"
    }`,
    tableCaption: `${labels.orderNumber}: ${invNo}`,
    tableHeaders: {
      index: labels.itemNo,
      item: labels.item,
      sku: labels.sku,
      unitPrice: labels.unitPrice,
      qty: labels.qty,
      discount: labels.discount,
      subtotal: labels.subtotal,
    },
    items,
    extraDiscountLabel: labels.extraDiscounts,
    extraDiscountNote: discountNote,
    extraDiscountValue: formatMoney(effectiveDiscountMoney, currency, locale),
    legalLines: [
      `${labels.contactInformation}: ${labels.webLabel}: ${sellerWebsite} | ${labels.emailLabel}: ${sellerEmail}`,
      `${labels.disclaimerTitle}: ${vatLegalNote(order, locale)}`,
      `${labels.returnPolicyTitle}: ${returnPolicyNote}`,
      asString(process.env.INVOICE_ADDITIONAL_NOTE) ||
        "Invoice number is matched to the order number as requested.",
    ],
  });
}

function computeRetryDelaySeconds(attempts: number): number {
  const normalizedAttempts = Math.max(1, Number(attempts || 1));
  return Math.min(15 * 60, 30 * 2 ** (normalizedAttempts - 1));
}

export async function processInvoiceJobs(input: ProcessInvoiceJobsInput): Promise<ProcessInvoiceJobsResult> {
  const shop = asString(input.shop);
  if (!shop) {
    throw new Error("processInvoiceJobs: missing shop");
  }

  const limitRaw = Number(input.limit ?? 5);
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 5;
  const lockOwner = asString(input.lockOwner) || `invoice-worker:${shop}`;
  const preferredOrderId = normalizeOrderId(input.preferredOrderId);
  const summary: ProcessInvoiceJobsResult = {
    shop,
    lockOwner,
    requestedLimit: limit,
    processed: 0,
    done: 0,
    skipped: 0,
    failed: 0,
    jobs: [],
  };

  for (let index = 0; index < limit; index += 1) {
    const job =
      index === 0 && preferredOrderId
        ? await claimQueuedInvoiceJobByOrderId(lockOwner, shop, preferredOrderId)
        : await claimNextQueuedInvoiceJob(lockOwner, shop);
    if (!job) break;

    summary.processed += 1;

    let documentId = "";
    let resolvedLocale: InvoiceLocale | null = null;

    try {
      const payload = parseJson(job.payloadJson);
      const storefrontLocale = detectStorefrontLocale(payload);
      const locale = job.orderLocale
        ? toInvoiceLocale(job.orderLocale)
        : ((await resolveInvoiceLocale(job.shop, storefrontLocale)) as InvoiceLocale);

      resolvedLocale = locale;
      const settings = await getInvoiceSettings(job.shop);
      if (settings && !toBoolean(settings.enabled)) {
        const reason = "Invoice automation disabled in settings";
        await markInvoiceJobSkipped(job.id, reason);
        summary.skipped += 1;
        summary.jobs.push({
          jobId: job.id,
          orderId: job.orderId,
          locale,
          status: "skipped",
          reason,
        });
        continue;
      }

      const order = await fetchOrderData(input.admin, job.orderId);
      if (!order) {
        const reason = `Order ${job.orderId} not found`;
        await markInvoiceJobSkipped(job.id, reason);
        summary.skipped += 1;
        summary.jobs.push({
          jobId: job.id,
          orderId: job.orderId,
          locale,
          status: "skipped",
          reason,
        });
        continue;
      }

      const template = await resolveTemplate(job.shop, locale, storefrontLocale);
      resolvedLocale = template.locale;
      const branding = await fetchShopBranding(input.admin);
      const seller = resolveSellerProfile(job.shop, settings, branding);
      const tokenMap = buildTemplateTokens(order, template.locale, seller);
      const rawTokenMap: Record<string, string> = {
        "order.items_rows": buildItemsRows(order, template.locale),
      };
      const renderedHtml = renderTemplate(template, tokenMap, rawTokenMap);
      const checksum = createHash("sha256").update(renderedHtml).digest("hex");

      documentId = await upsertInvoiceDocument({
        shop: job.shop,
        orderId: order.orderIdNumeric,
        orderName: order.name || job.orderName || "",
        orderEmail: order.email || order.customerEmail || job.orderEmail || "",
        locale: template.locale,
        checksum,
        template,
      });

      const pdfBuffer = buildPdfBuffer(order, template.locale, seller);
      const currentInvoiceNumber = invoiceNumber(order) || `#${order.orderIdNumeric}`;
      const persisted = await persistPdf({
        shop: job.shop,
        orderId: order.orderIdNumeric,
        locale: template.locale,
        invoiceNumber: currentInvoiceNumber,
        pdfBuffer,
      });
      const publicInvoiceUrl = buildInvoiceDownloadUrl({
        shop: job.shop,
        branding,
        documentId,
        storageKey: persisted.storageKey,
      });
      await markInvoiceDocumentGenerated({
        documentId,
        pdfStorageType: persisted.storageType,
        pdfStorageKey: persisted.storageKey,
        pdfUrl: publicInvoiceUrl || null,
      });
      if (publicInvoiceUrl) {
        try {
          await setOrderInvoiceUrlMetafield(input.admin, job.shop, order.id, publicInvoiceUrl);
        } catch (metafieldError) {
          console.error("[invoice] failed to set order invoice URL metafield", {
            shop: job.shop,
            orderId: order.orderIdNumeric,
            documentId,
            message: metafieldError instanceof Error ? metafieldError.message : String(metafieldError),
          });
        }
      }

      const customerEmailEnabled = isInvoiceCustomerEmailEnabled();
      if (!customerEmailEnabled) {
        await markInvoiceJobDone(job.id);
        summary.done += 1;
        summary.jobs.push({
          jobId: job.id,
          orderId: job.orderId,
          locale: template.locale,
          status: "done",
          invoiceDocumentId: documentId,
          reason: "customer invoice email disabled by INVOICE_SEND_CUSTOMER_EMAIL",
        });
        continue;
      }

      const recipientEmail = asString(order.email) || asString(order.customerEmail) || asString(job.orderEmail);
      if (!recipientEmail) {
        const reason = "Order email is missing; invoice PDF generated but email was not sent";
        await markInvoiceDocumentFailed(documentId, "missing_recipient", reason);
        await markInvoiceJobSkipped(job.id, reason);
        summary.skipped += 1;
        summary.jobs.push({
          jobId: job.id,
          orderId: job.orderId,
          locale: template.locale,
          status: "skipped",
          invoiceDocumentId: documentId,
          reason,
        });
        continue;
      }

      const envelope = resolveFromEnvelope(job.shop, seller, settings);
      const emailMessage = buildEmailMessage({
        locale: template.locale,
        shop: job.shop,
        order,
        seller,
        settings,
        invoiceUrl: publicInvoiceUrl,
      });
      const attachmentName = invoiceAttachmentFilename(currentInvoiceNumber, order.orderIdNumeric);

      await sendInvoiceEmailWithAttachment({
        to: recipientEmail,
        fromEmail: envelope.fromEmail,
        fromName: envelope.fromName,
        replyToEmail: envelope.replyToEmail,
        subject: emailMessage.subject,
        text: emailMessage.body,
        html: emailMessage.html,
        attachmentFilename: attachmentName,
        attachmentContent: pdfBuffer,
      });

      await markInvoiceDocumentSent({
        documentId,
        pdfStorageType: persisted.storageType,
        pdfStorageKey: persisted.storageKey,
        pdfUrl: publicInvoiceUrl || null,
        sentToEmail: recipientEmail,
      });

      await markInvoiceJobDone(job.id);
      summary.done += 1;
      summary.jobs.push({
        jobId: job.id,
        orderId: job.orderId,
        locale: template.locale,
        status: "done",
        invoiceDocumentId: documentId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown invoice processor error";
      if (documentId) {
        try {
          await markInvoiceDocumentFailed(documentId, "processing_error", message);
        } catch (markError) {
          console.error("[invoice] failed to mark document error", markError);
        }
      }

      const retryDelaySeconds = computeRetryDelaySeconds(job.attempts);
      await markInvoiceJobFailed(job.id, message, retryDelaySeconds);
      summary.failed += 1;
      summary.jobs.push({
        jobId: job.id,
        orderId: job.orderId,
        locale: resolvedLocale || (job.orderLocale ? toInvoiceLocale(job.orderLocale) : null),
        status: "failed",
        invoiceDocumentId: documentId || undefined,
        reason: message,
      });
      console.error("[invoice] process job failed", {
        shop: job.shop,
        jobId: job.id,
        orderId: job.orderId,
        attempts: job.attempts,
        retryDelaySeconds,
        message,
      });
    }
  }

  return summary;
}
