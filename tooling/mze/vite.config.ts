import { defineConfig } from "vite-plus";
import { packageTypecheckTask } from "../vite/package-tasks";

// This package exists so that mze can pin typescript 7 and run @effect/tsgo
// while the rest of the repository stays on 6. Its `tsc` therefore resolves to
// the one in this package, not the workspace root.
export default defineConfig({
  run: {
    tasks: {
      "check-types": packageTypecheckTask(),
    },
  },
});
