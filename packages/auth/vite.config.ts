import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../../tooling/vite/package-tasks";

export default defineConfig({
  run: {
    tasks: {
      build: packageBuildTask("varlock codegen && tsc -b && tsc-alias -p tsconfig.json --resolve-full-paths", [
        "packages/db",
      ]),
      "check-types": {
        // The generated env.ts is git-ignored, so produce it before tsc reads it.
        ...packageTypecheckTask(["packages/db"]),
        command: "varlock codegen && tsc --noEmit",
      },
    },
  },
});
