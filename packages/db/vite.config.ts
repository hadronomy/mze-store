import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../../tooling/vite/package-tasks";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  // Unbundled, so dist mirrors src file for file. The `./*` subpath export
  // needs that: it hands the consumer one module per schema file, and drizzle
  // table objects must keep their identity across those entry points. Packing
  // is also what resolves the ~/ alias — a package compiled inside a consumer's
  // program would get that consumer's ~/ instead.
  pack: {
    entry: ["src/**/*.ts"],
    unbundle: true,
    dts: true,
    sourcemap: true,
    format: ["esm"],
  },
  run: {
    tasks: {
      build: packageBuildTask("vp pack"),
      "check-types": {
        // The generated env.ts is git-ignored, so produce it before tsc reads it.
        ...packageTypecheckTask(),
        command: "varlock codegen && tsc --noEmit",
      },
    },
  },
});
