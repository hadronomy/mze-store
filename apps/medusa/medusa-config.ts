import { defineConfig, loadEnv } from "@medusajs/framework/utils";
import { parse } from "@mze-store/env/medusa";
import { resolve } from "node:path";
import { adminFavicon } from "~/admin/favicon";
import { STRIPE_MODULE_ID } from "~/payment/stripe";
import { withPortlessCors } from "~/portless";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

const env = parse(withPortlessCors(process.env));
const redisUrl = env.REDIS_URL;

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
    databaseUrl: env.DATABASE_URL,
    redisUrl,
    http: {
      storeCors: env.STORE_CORS,
      adminCors: env.ADMIN_CORS,
      authCors: env.AUTH_CORS,
      jwtSecret: env.JWT_SECRET,
      cookieSecret: env.COOKIE_SECRET,
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
            options: { apiKey: env.STRIPE_API_KEY },
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
  ],
});
