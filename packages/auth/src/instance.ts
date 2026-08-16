import { createDb } from "@mze-store/db";

import { ENV } from "../env";
import { createAuth } from "./index";

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  auth ??= createAuth({
    database: createDb(ENV.DATABASE_URL),
    secret: ENV.BETTER_AUTH_SECRET,
    baseURL: ENV.BETTER_AUTH_URL,
    trustedOrigins: [ENV.CORS_ORIGIN],
  });

  return auth;
}
