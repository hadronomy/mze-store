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
  ".vite-hooks/**",
  "test-results/**",
  "playwright-report/**",
];

export default defineConfig({
  run: {
    tasks: {
      "staged-check": {
        command: "vp check --fix",
        dependsOn: ["@mze-store/oxlint#build"],
        cache: false,
      },
    },
  },
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
    jsPlugins: [
      "@mze-store/oxlint",
      {
        name: "anti-slop",
        specifier: "./tooling/oxlint/anti-slop/index.ts",
      },
    ],
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: false,
    },
    rules: {
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
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
    "*.{js,ts,jsx,tsx,vue,svelte,json,jsonc,css,md}": "vp run staged-check",
  },
});
