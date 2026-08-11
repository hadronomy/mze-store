import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../../tooling/vite/package-tasks";

const entries = {
  index: "src/index.ts",
  spain: "src/spain.ts",
};

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  pack: {
    entry: entries,
    dts: true,
    format: {
      esm: {},
      cjs: { entry: entries },
    },
  },
  run: {
    tasks: {
      build: packageBuildTask("vp pack"),
      "check-types": packageTypecheckTask(),
    },
  },
});
