import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";
import { parse } from "@mze-store/env/database";

dotenv.config({
  path: "../../apps/storefront/.env",
});

const env = parse(process.env);

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  schemaFilter: ["auth"],
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
