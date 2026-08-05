import type { Db } from "@mze-store/db";
import * as schema from "@mze-store/db/schema/auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export interface AuthOptions {
  database?: Db;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
}

export function createAuth({ database, secret, baseURL, trustedOrigins }: AuthOptions) {
  return betterAuth({
    ...(database
      ? {
          database: drizzleAdapter(database, {
            provider: "pg",
            schema,
          }),
        }
      : {}),
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
    },
    secret,
    baseURL,
    plugins: [tanstackStartCookies()],
  });
}
