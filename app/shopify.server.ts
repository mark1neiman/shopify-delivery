import "@shopify/shopify-app-react-router/adapters/node";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = process.env.ENV_FILE || path.join(moduleDir, "..", "process.env");
loadEnv({ path: envPath, override: true });

const normalizeEnv = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return "";
  return trimmed;
};

process.env.SHOPIFY_API_KEY = normalizeEnv(process.env.SHOPIFY_API_KEY);
process.env.SHOPIFY_API_SECRET = normalizeEnv(process.env.SHOPIFY_API_SECRET);
process.env.SHOPIFY_APP_URL = normalizeEnv(process.env.SHOPIFY_APP_URL);
process.env.SCOPES = normalizeEnv(process.env.SCOPES);
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
