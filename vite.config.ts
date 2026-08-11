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

// Track source globs explicitly because TypeScript can satisfy an incremental
// run from `.tsbuildinfo` without reading the source files.
const workspaceInputs = ["package.json", "bun.lock", "vite.config.ts", "packages/config/**"];

function packageInputs(cwd: string, dependencies: string[] = []) {
  const packages = [cwd, ...dependencies];

  return [
    { auto: true },
    ...workspaceInputs,
    ...packages.flatMap((packagePath) => [
      `${packagePath}/src/**`,
      `${packagePath}/package.json`,
      `${packagePath}/tsconfig*.json`,
      `${packagePath}/vite.config.ts`,
    ]),
    ...packages.map((packagePath) => `!${packagePath}/**/*.tsbuildinfo`),
    ...packages.map((packagePath) => `!${packagePath}/dist/**`),
  ];
}

function packageBuildTask(cwd: string, command: string, dependencies: string[] = []) {
  return {
    command,
    cwd,
    input: packageInputs(cwd, dependencies),
    output: [{ auto: true }, `!${cwd}/**/*.tsbuildinfo`],
  };
}

function packageTypecheckTask(cwd: string, dependencies: string[] = []) {
  return {
    command: "tsc --noEmit",
    cwd,
    input: packageInputs(cwd, dependencies),
    output: [],
  };
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  run: {
    tasks: {
      "package-build":
        "vp run package-env-build && vp run package-db-build && vp run package-auth-build && vp run package-ui-build",
      "package-check-types":
        "vp run package-env-check-types && vp run package-db-check-types && vp run package-auth-check-types && vp run package-ui-check-types",
      "package-env-build": packageBuildTask("packages/env", "vp pack"),
      "package-db-build": packageBuildTask("packages/db", "tsc -b && tsc-alias -p tsconfig.json", [
        "packages/env",
      ]),
      "package-auth-build": packageBuildTask(
        "packages/auth",
        "tsc -b && tsc-alias -p tsconfig.json",
        ["packages/db", "packages/env"],
      ),
      "package-ui-build": packageBuildTask("packages/ui", "tsc -b && tsc-alias -p tsconfig.json"),
      "package-env-check-types": packageTypecheckTask("packages/env"),
      "package-db-check-types": packageTypecheckTask("packages/db", ["packages/env"]),
      "package-auth-check-types": packageTypecheckTask("packages/auth", [
        "packages/db",
        "packages/env",
      ]),
      "package-ui-check-types": packageTypecheckTask("packages/ui"),
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
