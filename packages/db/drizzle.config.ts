import { defineConfig } from "drizzle-kit";
import { ENV } from "./env";

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  schemaFilter: ["auth"],
  dbCredentials: {
    url: ENV.DATABASE_URL,
  },
});
