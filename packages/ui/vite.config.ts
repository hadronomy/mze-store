import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../../tooling/vite/package-tasks";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  // Unbundled, so dist mirrors src file for file — the `./components/*` and
  // `./lib/*` subpath exports hand consumers one module each. Packing is what
  // resolves the ~/ alias: a package compiled inside a consumer's program would
  // get that consumer's ~/, so the alias only stays private while this builds
  // on its own.
  pack: {
    entry: ["src/**/*.ts", "src/**/*.tsx"],
    unbundle: true,
    dts: true,
    sourcemap: true,
    format: ["esm"],
  },
  run: {
    tasks: {
      build: packageBuildTask("vp pack"),
      "check-types": packageTypecheckTask(),
    },
  },
});
