import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      rules: "src/rules/index.ts",
    },
    dts: true,
    format: { esm: {} },
    sourcemap: true,
  },
});
