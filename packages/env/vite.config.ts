import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../../tooling/vite/package-tasks";

const serverEntries = {
  database: "src/database.ts",
  server: "src/server.ts",
  medusa: "src/medusa.ts",
};

export default defineConfig({
  pack: {
    entry: serverEntries,
    dts: true,
    format: {
      esm: {},
      cjs: { entry: serverEntries },
    },
    deps: {
      alwaysBundle: "@t3-oss/env-core",
      onlyBundle: false,
    },
  },
  run: {
    tasks: {
      build: packageBuildTask("vp pack"),
      "check-types": packageTypecheckTask(),
    },
  },
});
