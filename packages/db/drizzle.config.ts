import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: "../../apps/storefront/.env",
});

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  schemaFilter: ["auth"],
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});
