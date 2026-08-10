import { configDefaults, defineConfig } from "vite-plus";

// Generated or built output. Shared by lint, format, and test so the tools do not drift.
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
  resolve: {
    tsconfigPaths: true,
  },
  // Keep cache probes opt-in until their fingerprints are stable in CI.
  run: {
    cache: {
      scripts: false,
      tasks: true,
    },
    tasks: {
      "cache:packages": {
        command:
          "vp run --cache @mze-store/env#build && vp run --cache --filter @mze-store/db build && vp run --cache --filter @mze-store/auth build && vp run --cache --filter @mze-store/ui build",
        cache: true,
      },
      "cache:typecheck": {
        command: "vp run --cache --filter './packages/*' check-types",
        cache: true,
      },
    },
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
    jsPlugins: ["./tooling/oxlint/index.ts"],
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: false,
    },
    rules: {
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
