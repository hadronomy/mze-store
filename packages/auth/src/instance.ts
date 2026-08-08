import { createDb } from "@mze-store/db";
import { env } from "@mze-store/env/server";

import { createAuth } from "./index";

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  auth ??= createAuth({
    database: createDb(env.DATABASE_URL),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.CORS_ORIGIN],
  });

  return auth;
}
