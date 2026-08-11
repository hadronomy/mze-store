const workspaceInputs = [
  "package.json",
  "bun.lock",
  "packages/config/**",
  "tooling/vite/package-tasks.ts",
];

function workspaceInput(pattern: string) {
  return { pattern, base: "workspace" as const };
}

function packageSelector(packagePath: string) {
  return `@mze-store/${packagePath.slice("packages/".length)}#build`;
}

function packageInputs(dependencies: string[] = []) {
  return [
    { auto: true },
    "src/**",
    "package.json",
    "tsconfig*.json",
    "vite.config.ts",
    ...workspaceInputs.map(workspaceInput),
    ...dependencies.flatMap((packagePath) => [
      workspaceInput(`${packagePath}/src/**`),
      workspaceInput(`${packagePath}/package.json`),
      workspaceInput(`${packagePath}/tsconfig*.json`),
      workspaceInput(`${packagePath}/vite.config.ts`),
      workspaceInput(`!${packagePath}/**/*.tsbuildinfo`),
      workspaceInput(`!${packagePath}/dist/**`),
    ]),
    "!**/*.tsbuildinfo",
    "!dist/**",
  ];
}

export function packageBuildTask(command: string, dependencies: string[] = []) {
  return {
    command,
    dependsOn: dependencies.map(packageSelector),
    input: packageInputs(dependencies),
    output: [{ auto: true }, "!**/*.tsbuildinfo"],
  };
}

export function packageTypecheckTask(dependencies: string[] = []) {
  return {
    command: "tsc --noEmit",
    dependsOn: dependencies.map(packageSelector),
    input: packageInputs(dependencies),
    output: [],
  };
}
