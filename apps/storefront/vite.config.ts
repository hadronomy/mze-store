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
  // React Scan imports React Grab's package metadata. Bundle both development
  // tools for SSR so Node does not try to load that JSON file as an external
  // module before the client-only effect runs.
  ssr: {
    noExternal: ["react-scan", "react-grab"],
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
