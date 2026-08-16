import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    // `varlock run` starts every process, so the built server needs the init
    // calls only. `auto-load` would resolve the schema a second time.
    varlockVitePlugin({ ssrInjectMode: "init-only" }),
    tailwindcss(),
    tanstackStart(),
    nitro(),
    viteReact(),
  ],
});
