import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../../tooling/vite/package-tasks";

export default defineConfig({
  run: {
    tasks: {
      build: packageBuildTask("tsc -b && tsc-alias -p tsconfig.json --resolve-full-paths"),
      "check-types": packageTypecheckTask([]),
    },
  },
});
