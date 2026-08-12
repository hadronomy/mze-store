import { configDefaults, defineConfig } from "vite-plus";

// Generated or built output. Shared by lint, format, and test so the tools do not drift.
const ignorePatterns = [
  "node_modules/**",
  "**/node_modules/**",
  ".cache/**",
  "apps/storefront/dist/**",
  "apps/storefront/.vinxi/**",
  "apps/storefront/.tanstack/**",
  "apps/storefront/.output/**",
  "apps/storefront/src/routeTree.gen.ts",
  "apps/medusa/.medusa/**",
  "packages/*/dist/**",
  "tooling/oxlint/dist/**",
];

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      ...ignorePatterns,
      "e2e/**",
      "apps/medusa/integration-tests/**",
    ],
    globalSetup: "./tooling/test/global-setup.ts",
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc"],
    categories: {
      correctness: "error",
    },
    env: {
      builtin: true,
    },
    ignorePatterns,
    jsPlugins: ["@mze-store/oxlint"],
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: false,
    },
    rules: {
      "hadronomy/no-broad-record-types": "error",
      "hadronomy/prefer-tilde-imports": "error",
      "unicorn/no-abusive-eslint-disable": "error",
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
