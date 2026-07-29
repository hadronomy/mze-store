import { fileURLToPath } from "node:url";

import evlog from "evlog/nitro/v3";
import { defineConfig } from "nitro";

const authPlugin = fileURLToPath(new URL("./server/plugins/evlog-auth.ts", import.meta.url));

export default defineConfig({
  experimental: {
    asyncContext: true,
  },
  modules: [
    evlog({
      env: { service: "mze-store-web" },
    }),
    // Registered from a module rather than `plugins` or `serverDir` scanning,
    // purely for ordering: evlog's module appends its own plugin during setup,
    // so anything collected earlier hooks `request` first and finds no logger
    // on the context yet. Running after evlog guarantees one exists.
    {
      name: "evlog-auth",
      setup(nitro) {
        nitro.options.plugins.push(authPlugin);
      },
    },
  ],
});
