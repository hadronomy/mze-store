import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../vite/package-tasks";

const checkTypes = packageTypecheckTask();

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  pack: {
    entry: {
      index: "src/index.ts",
      rules: "src/rules/index.ts",
    },
    dts: true,
    format: { esm: {} },
    sourcemap: true,
  },
  run: {
    tasks: {
      build: packageBuildTask("vp pack"),
      "check-types": {
        ...checkTypes,
        dependsOn: ["@mze-store/oxlint#build"],
      },
    },
  },
});
