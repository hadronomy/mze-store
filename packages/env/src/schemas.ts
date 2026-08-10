import { z } from "zod";

export const databaseUrlSchema = z.string().min(1);

export const databaseEnvironmentSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
});

export const medusaEnvironmentSchema = z.object({
  COOKIE_SECRET: z.string().min(1),
  DATABASE_URL: databaseUrlSchema,
  JWT_SECRET: z.string().min(1),
  REDIS_URL: z.string().min(1),
  STRIPE_API_KEY: z.string().startsWith("sk_", "STRIPE_API_KEY must be a Stripe secret key"),
  STORE_CORS: z.string().min(1),
  ADMIN_CORS: z.string().min(1),
  AUTH_CORS: z.string().min(1),
});

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;
