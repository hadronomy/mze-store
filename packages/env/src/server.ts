import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { databaseUrlSchema } from "./schemas";

function getPortlessDevelopmentOrigin(source: Readonly<Record<string, string | undefined>>) {
  const nodeEnvironment = source.NODE_ENV;

  if (
    !source.PORTLESS_URL ||
    source.CI ||
    (nodeEnvironment !== undefined && nodeEnvironment !== "development")
  ) {
    return undefined;
  }

  return source.PORTLESS_URL;
}

const portlessDevelopmentOrigin = getPortlessDevelopmentOrigin(process.env);
const runtimeEnv = { ...process.env };

if (portlessDevelopmentOrigin !== undefined) {
  runtimeEnv.BETTER_AUTH_URL = portlessDevelopmentOrigin;
  runtimeEnv.CORS_ORIGIN = portlessDevelopmentOrigin;
}

export const env = createEnv({
  server: {
    DATABASE_URL: databaseUrlSchema,
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORTLESS_URL: z.url().optional(),
  },
  runtimeEnv,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
