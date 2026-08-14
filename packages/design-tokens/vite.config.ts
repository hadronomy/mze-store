import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../../tooling/vite/package-tasks";

const entries = {
  index: "src/index.ts",
  email: "src/email.ts",
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
      // The CSS emitter reads the packed ESM output, so it has to follow pack.
      build: packageBuildTask("vp pack && node ./scripts/emit-theme-css.mjs"),
      "check-types": packageTypecheckTask(),
    },
  },
});
