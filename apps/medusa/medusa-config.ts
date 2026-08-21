import { defineConfig } from "@medusajs/framework/utils";
import { resolve } from "node:path";
import { ENV as RESOLVED } from "varlock/init-server";
import { adminFavicon } from "~/admin/favicon";
import { STRIPE_MODULE_ID } from "~/payment/stripe";
import type { CoercedEnvSchema } from "./env";

// Runtime initialization belongs to `varlock/init-server`. The generated
// module supplies only the type here, so keep this dependency type-only and
// avoid a second runtime initialization path. See ADR-0012.
const ENV = RESOLVED as Readonly<CoercedEnvSchema>;

const redisUrl = ENV.REDIS_URL;

export default defineConfig({
  admin: {
    vite: (config) => ({
      ...config,
      plugins: [...(config.plugins ?? []), adminFavicon()],
      resolve: {
        ...config.resolve,
        alias: [
          { find: "~", replacement: resolve(process.cwd(), "src/admin") },
          ...(Array.isArray(config.resolve?.alias)
            ? config.resolve.alias
            : Object.entries(config.resolve?.alias ?? {}).map(([find, replacement]) => ({
                find,
                replacement,
              }))),
        ],
      },
    }),
  },
  projectConfig: {
    databaseUrl: ENV.DATABASE_URL,
    redisUrl,
    http: {
      storeCors: ENV.STORE_CORS,
      adminCors: ENV.ADMIN_CORS,
      authCors: ENV.AUTH_CORS,
      jwtSecret: ENV.JWT_SECRET,
      cookieSecret: ENV.COOKIE_SECRET,
    },
  },
  // Keep these modules unconditional. The environment parser requires Redis
  // before Medusa reads this config. Optional registration would let the
  // backend use in-memory defaults and lose shared state across processes or
  // restarts, which is the correctness failure described in ADR-0006.
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/payment-stripe",
            id: STRIPE_MODULE_ID,
            options: { apiKey: ENV.STRIPE_API_KEY },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/cache-redis",
      options: { redisUrl },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: { redisUrl },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: { redis: { redisUrl } },
    },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            id: "locking-redis",
            resolve: "@medusajs/medusa/locking-redis",
            is_default: true,
            options: { redisUrl },
          },
        ],
      },
    },
    {
      resolve: "./src/modules/tax-rate-audit",
    },
    {
      resolve: "./src/modules/catalog-sync",
      options: {
        odoo: {
          apiKey: ENV.ODOO_API_KEY,
          baseUrl: ENV.ODOO_BASE_URL,
          database: ENV.ODOO_DATABASE,
        },
      },
    },
  ],
});
