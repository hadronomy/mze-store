import { z } from "zod";

export const databaseUrlSchema = z.string().min(1);

export const medusaEnvironmentSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  STORE_CORS: z.string().min(1),
  ADMIN_CORS: z.string().min(1),
  AUTH_CORS: z.string().min(1),
});

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;
