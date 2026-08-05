import { defineConfig, loadEnv } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { STRIPE_MODULE_ID } from "./src/payment/stripe";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

const redisUrl = process.env.REDIS_URL;
const stripeEnv = z
  .object({
    STRIPE_API_KEY: z.string().startsWith("sk_", "STRIPE_API_KEY must be a Stripe secret key"),
  })
  .parse(process.env);

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  // Registered unconditionally, and that is the point. Medusa's self-hosted
  // defaults are the in-memory cache, event bus, workflow engine, and locking
  // provider; it reads REDIS_URL on its own only when running on Medusa Cloud.
  // Gating these on the env var would restore exactly the failure ADR-0006
  // exists to prevent: a backend that boots looking healthy while overselling
  // stock and losing in-flight workflows across a restart. All four modules
  // throw when `redisUrl` is absent, so a missing Redis fails loudly instead.
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/payment-stripe",
            id: STRIPE_MODULE_ID,
            options: { apiKey: stripeEnv.STRIPE_API_KEY },
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
  ],
});
