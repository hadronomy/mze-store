import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../../tooling/vite/package-tasks";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  // Unbundled, so dist mirrors the source tree, and packing is what resolves
  // the ~/ alias — a package compiled inside a consumer's program would get
  // that consumer's ~/ instead. auth.ts sits at the package root next to src/,
  // which puts the root in the output base: hence dist/auth.mjs beside
  // dist/src/. The .test.ts files under src/ are not entry points.
  pack: {
    entry: ["auth.ts", "src/index.ts", "src/instance.ts"],
    unbundle: true,
    dts: true,
    sourcemap: true,
    format: ["esm"],
  },
  run: {
    tasks: {
      build: packageBuildTask(
        // instance.ts imports the generated env.ts, which is git-ignored.
        "varlock codegen && vp pack",
        ["packages/db"],
      ),
      "check-types": {
        // The generated env.ts is git-ignored, so produce it before tsc reads it.
        ...packageTypecheckTask(["packages/db"]),
        command: "varlock codegen && tsc --noEmit",
      },
    },
  },
});
