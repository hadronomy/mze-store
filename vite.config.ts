import { defineConfig } from "vite-plus";

// Generated or built output. Shared by lint and fmt so the two cannot drift.
const ignorePatterns = [
  "node_modules/**",
  "**/node_modules/**",
  "apps/storefront/dist/**",
  "apps/storefront/.vinxi/**",
  "apps/storefront/.tanstack/**",
  "apps/storefront/.output/**",
  "apps/storefront/src/routeTree.gen.ts",
  "apps/medusa/.medusa/**",
  "packages/*/dist/**",
];

export default defineConfig({
  tasks: {
    // A package must not build against stale declarations from a workspace
    // dependency. No package emits a build yet, so this only starts doing work
    // once `vp pack` lands for the shared packages — declared now so ordering
    // is never the thing that has to be discovered later.
    build: {
      dependsOn: [{ task: "build", from: "dependencies" }],
    },
    "check-types": {
      dependsOn: [{ task: "build", from: "dependencies" }],
    },
  },
  lint: {
    ignorePatterns,
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
  fmt: {
    ignorePatterns,
    singleQuote: false,
    semi: true,
    sortPackageJson: true,
  },
  staged: {
    "*.{js,ts,jsx,tsx,vue,svelte,json,jsonc,css,md}": "vp check --fix",
  },
});
