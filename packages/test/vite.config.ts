import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../../tooling/vite/package-tasks";

export default defineConfig({
  pack: {
    entry: "src/index.ts",
    dts: true,
    format: {
      esm: {},
      cjs: {},
    },
  },
  run: {
    tasks: {
      build: packageBuildTask("vp pack"),
      "check-types": packageTypecheckTask(),
    },
  },
});
