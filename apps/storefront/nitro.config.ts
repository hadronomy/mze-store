import evlog from "evlog/nitro/v3";
import { defineConfig } from "nitro";

export default defineConfig({
  // Nitro 3 defaults this to false, so `server/` is not scanned at all and
  // nothing under `server/middleware/` loads. Nitro 2 scanned it by default,
  // which is what the scaffold assumed.
  serverDir: "./server",
  experimental: {
    asyncContext: true,
  },
  modules: [
    evlog({
      env: { service: "mze-store-storefront" },
    }),
  ],
});
