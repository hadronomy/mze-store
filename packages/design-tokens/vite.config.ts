import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../../tooling/vite/package-tasks";

const entries = {
  index: "src/index.ts",
  email: "src/email.ts",
};

/** Source maps embed the token modules, so they are a development aid only. */
const sourceMapFlag = process.env.NODE_ENV === "production" ? "" : " --source-map";

// The emitter reads src/ directly, so packing and generating the stylesheet
// have no order between them. They stay one task all the same: both write into
// dist/, and as separate tasks the cached output of whichever ran first is
// restored over the other's files. Splitting them would need disjoint output
// directories, which is a bigger change than the caching is worth.

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
      // Resolved here, so the flag is baked into the command the task runner
      // caches on. A production build and a development build are therefore
      // different cache entries and cannot replay into one another.
      build: packageBuildTask(`vp pack && node ./scripts/emit-theme-css.ts${sourceMapFlag}`),
      "check-types": packageTypecheckTask(),
    },
  },
});
