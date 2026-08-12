import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, expect, test } from "@effect/vitest";

import { getPreferredSpecifier } from "~/rules";

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(import.meta.dirname, "../../..");
let projectRoot: string;

async function writeProjectFile(relativePath: string, contents: string): Promise<string> {
  const path = join(projectRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
}

beforeAll(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "hadronomy-oxlint-"));
  await writeProjectFile(
    "tsconfig.base.json",
    `{
      // The rule must accept the same JSONC syntax as TypeScript.
      "compilerOptions": {
        "module": "ESNext",
        "moduleResolution": "bundler",
        "paths": { "~/*": ["./missing/*", "./src/*"] }
      }
    }`,
  );
  await writeProjectFile(
    "tsconfig.json",
    `{ "extends": "./tsconfig.base.json", "include": ["**/*.ts"] }`,
  );
  await writeProjectFile("src/features/view.ts", "export {};\n");
  await writeProjectFile("src/features/helper.ts", "export {};\n");
  await writeProjectFile("src/shared/value.ts", "export {};\n");
  await writeProjectFile("src/shared/index.ts", "export {};\n");
  await writeProjectFile("src/styles/theme.css", ":root {}\n");
  await writeProjectFile("outside.ts", "export {};\n");
  await writeProjectFile(
    "src/admin/tsconfig.json",
    `{ "compilerOptions": { "moduleResolution": "bundler", "paths": { "~/*": ["./*"] } } }`,
  );
  await writeProjectFile("src/admin/widgets/view.ts", "export {};\n");
  await writeProjectFile("src/admin/utils/helper.ts", "export {};\n");
});

afterAll(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

test("a cross-directory import uses the source surface alias and keeps its suffix", () => {
  const filename = join(projectRoot, "src/features/view.ts");

  expect(getPreferredSpecifier(filename, "../shared/value?raw#section")).toBe(
    "~/shared/value?raw#section",
  );
});

test("a same-directory import uses ./", () => {
  const filename = join(projectRoot, "src/features/view.ts");

  expect(getPreferredSpecifier(filename, "~/features/helper")).toBe("./helper");
});

test("a directory index keeps the directory module specifier", () => {
  const filename = join(projectRoot, "src/features/view.ts");

  expect(getPreferredSpecifier(filename, "../shared")).toBe("~/shared");
});

test("a target outside the alias root is unchanged", () => {
  const filename = join(projectRoot, "src/features/view.ts");

  expect(getPreferredSpecifier(filename, "../../outside")).toBeNull();
});

test("an unresolved import is unchanged", () => {
  const filename = join(projectRoot, "src/features/view.ts");

  expect(getPreferredSpecifier(filename, "../missing/value")).toBeNull();
});

test("a non-TypeScript target uses the filesystem fallback", () => {
  const filename = join(projectRoot, "src/features/view.ts");

  expect(getPreferredSpecifier(filename, "../styles/theme.css?inline")).toBe(
    "~/styles/theme.css?inline",
  );
});

test("the nearest nested tsconfig defines the alias root", () => {
  const filename = join(projectRoot, "src/admin/widgets/view.ts");

  expect(getPreferredSpecifier(filename, "../utils/helper")).toBe("~/utils/helper");
});

test("vp lint --fix applies the plugin once and is idempotent", { timeout: 30_000 }, async () => {
  const cliProjectRoot = await mkdtemp(join(tmpdir(), "hadronomy-oxlint-cli-"));
  const sourcePath = join(cliProjectRoot, "src/pages/page.ts");

  try {
    await mkdir(dirname(sourcePath), { recursive: true });
    await mkdir(join(cliProjectRoot, "src/shared"), { recursive: true });
    await writeFile(
      join(cliProjectRoot, "tsconfig.json"),
      `{ "compilerOptions": { "moduleResolution": "bundler", "paths": { "~/*": ["./src/*"] } } }`,
    );
    await writeFile(join(cliProjectRoot, "src/shared/value.ts"), "export const value = 1;\n");
    await writeFile(sourcePath, `import { value } from "../shared/value";\nvoid value;\n`);

    const runLintFix = () =>
      execFileAsync(resolve(workspaceRoot, "node_modules/.bin/vp"), ["lint", "--fix", sourcePath], {
        cwd: workspaceRoot,
      });

    await runLintFix();
    const firstResult = await readFile(sourcePath, "utf8");
    await runLintFix();

    expect(firstResult).toBe(`import { value } from "~/shared/value";\nvoid value;\n`);
    expect(await readFile(sourcePath, "utf8")).toBe(firstResult);
  } finally {
    await rm(cliProjectRoot, { recursive: true, force: true });
  }
});

test(
  "vp lint --fix covers static module references and ignores dynamic ones",
  { timeout: 30_000 },
  async () => {
    const cliProjectRoot = await mkdtemp(join(tmpdir(), "hadronomy-oxlint-syntax-"));
    const sourcePath = join(cliProjectRoot, "src/pages/page.ts");

    try {
      await mkdir(dirname(sourcePath), { recursive: true });
      await mkdir(join(cliProjectRoot, "src/shared"), { recursive: true });
      await writeFile(
        join(cliProjectRoot, "tsconfig.json"),
        `{ "compilerOptions": { "moduleResolution": "bundler", "paths": { "~/*": ["./src/*"] } } }`,
      );
      await writeFile(
        join(cliProjectRoot, "src/shared/value.ts"),
        "export const value = 1; export type Value = number;\n",
      );
      await writeFile(
        sourcePath,
        [
          `import { value } from "../shared/value";`,
          `export { value as sharedValue } from "../shared/value";`,
          `export * from "../shared/value";`,
          `type Value = import("../shared/value").Value;`,
          `import valueModule = require("../shared/value");`,
          `void import("../shared/value");`,
          "void import(`../shared/value`);",
          `void require("../shared/value");`,
          `void require.resolve("../shared/value");`,
          `const part = "value";`,
          "void import(`../shared/${part}`);",
          `function local(require: (path: string) => unknown) { require("../shared/value"); }`,
          `void value; void valueModule; const typed: Value = 1; void typed; void local;`,
          "",
        ].join("\n"),
      );

      await execFileAsync(
        resolve(workspaceRoot, "node_modules/.bin/vp"),
        ["lint", "--fix", sourcePath],
        { cwd: workspaceRoot },
      );

      const result = await readFile(sourcePath, "utf8");
      expect(result).toBe(
        [
          `import { value } from "~/shared/value";`,
          `export { value as sharedValue } from "~/shared/value";`,
          `export * from "~/shared/value";`,
          `type Value = import("~/shared/value").Value;`,
          `import valueModule = require("~/shared/value");`,
          `void import("~/shared/value");`,
          "void import(`~/shared/value`);",
          `void require("~/shared/value");`,
          `void require.resolve("~/shared/value");`,
          `const part = "value";`,
          "void import(`../shared/${part}`);",
          `function local(require: (path: string) => unknown) { require("../shared/value"); }`,
          `void value; void valueModule; const typed: Value = 1; void typed; void local;`,
          "",
        ].join("\n"),
      );
    } finally {
      await rm(cliProjectRoot, { recursive: true, force: true });
    }
  },
);
