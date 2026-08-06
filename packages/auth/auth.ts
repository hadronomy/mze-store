import { createDb } from "@mze-store/db";

import { createAuth } from "./src/index";

const cliOrigin = "http://localhost:3001";

export const auth = createAuth({
  // Schema generation reads adapter metadata only. Port 1 prevents an
  // accidental connection from reaching a developer database.
  database: createDb("postgresql://cli:cli@127.0.0.1:1/cli"),
  secret: "better-auth-cli-only-secret-value",
  baseURL: cliOrigin,
  trustedOrigins: [cliOrigin],
});
