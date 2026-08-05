import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

export function createDb(connectionUrl: string) {
  return drizzle(connectionUrl, { schema });
}

export type Db = ReturnType<typeof createDb>;
