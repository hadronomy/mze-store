import { expect, test } from "@effect/vitest";
import { Effect, Option } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Diagnostic, FileContext, Rule, Visitor } from "effect-oxlint";
import { createMockContext, importDecl } from "effect-oxlint/testing";

import { createOnceContextContract, runOxlintBaseline } from "~/baseline";
import { preferTildeImportsRule } from "~/rules";

test("records each module reference, fix, and timing sample", { timeout: 120_000 }, async () => {
  const report = await runOxlintBaseline({ samples: 1 });

  expect(report.schemaVersion).toBe(2);
  expect(report.seed).toBe("effect-oxlint-baseline-v2");
  expect(report.input).toMatchObject({
    fileCount: 2,
    supportedReferenceCount: 10,
  });
  expect(report.input.sourceBytes).toBeGreaterThan(0);
  expect(report.behavior.map(({ name }) => name)).toEqual([
    "import-declaration",
    "named-export",
    "export-all",
    "typescript-import-type",
    "typescript-import-equals",
    "dynamic-import-string",
    "dynamic-import-static-template",
    "commonjs-require",
    "commonjs-require-resolve",
    "specifier-suffix",
  ]);
  expect(report.behavior.map(({ diagnostic }) => [diagnostic.line, diagnostic.column])).toEqual([
    [1, 23],
    [2, 38],
    [3, 15],
    [4, 21],
    [5, 30],
    [6, 13],
    [7, 13],
    [8, 14],
    [9, 22],
    [10, 15],
  ]);

  for (const behavior of report.behavior) {
    expect(behavior.diagnostic).toMatchObject({
      code: "hadronomy(prefer-tilde-imports)",
      severity: "error",
    });
    expect(behavior.diagnostic.message).toContain("Use '~/shared/value");
    expect(behavior.fix.before).toContain("../shared/value");
    expect(behavior.fix.after).toContain("~/shared/value");
  }

  expect(report.ignored).toEqual([
    { name: "computed-dynamic-import", unchanged: true },
    { name: "shadowed-require", unchanged: true },
  ]);
  expect(report.fix).toMatchObject({
    changedOnFirstRun: true,
    matchesExpectedOutput: true,
    cleanOnSecondRun: true,
  });
  expect(report.lifecycle).toEqual(createOnceContextContract);
  expect(report.timing.samplesMs).toHaveLength(1);
  expect(report.timing.medianMs).toBeGreaterThan(0);
});

test("uses the physical filename when Oxlint supplies a virtual filename", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "hadronomy-oxlint-filename-"));
  const sourcePath = join(projectRoot, "src/pages/page.ts");

  try {
    await mkdir(dirname(sourcePath), { recursive: true });
    await mkdir(join(projectRoot, "src/shared"), { recursive: true });
    await writeFile(
      join(projectRoot, "tsconfig.json"),
      `{ "compilerOptions": { "moduleResolution": "bundler", "paths": { "~/*": ["./src/*"] } } }`,
    );
    await writeFile(join(projectRoot, "src/shared/value.ts"), "export const value = 1;\n");
    await writeFile(sourcePath, `import { value } from "../shared/value";\n`);

    const logicalFilename = "virtual:mze-store/page.ts";
    const { context, diagnostics } = createMockContext({ filename: sourcePath });
    Object.defineProperties(context, {
      filename: { value: logicalFilename },
      getFilename: { value: () => logicalFilename },
    });
    const visitor = preferTildeImportsRule.createOnce(context);

    expect(visitor.before?.()).toBe(true);
    visitor.ImportDeclaration?.(importDecl("../shared/value"));
    visitor.after?.();

    expect(context.filename).toBe(logicalFilename);
    expect(context.physicalFilename).toBe(sourcePath);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          data: { replacement: "~/shared/value" },
          messageId: "preferTildeImports",
        }),
      }),
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("enforces the recorded createOnce context lifecycle", () => {
  const phases: string[] = [];
  let setupFileContextAvailable = true;
  let readAfterClose = () => "";
  const { context, diagnostics } = createMockContext({
    filename: "/project/src/file.ts",
    options: [{ mode: "certification" }],
  });
  const plan = Rule.plan({
    name: "baseline-lifecycle",
    meta: Rule.meta({ type: "suggestion", description: "Baseline lifecycle" }),
    create: () =>
      Effect.gen(function* () {
        setupFileContextAvailable = Option.isSome(
          yield* Effect.serviceOption(FileContext.FileContext),
        );

        return {
          before: Effect.gen(function* () {
            const file = yield* FileContext.FileContext;
            expect(file.id).toBe("effect/test-rule");
            expect(file.filename).toBe("/project/src/file.ts");
            expect(file.physicalFilename).toBe("/project/src/file.ts");
            expect(file.cwd).toBe("/test");
            expect(file.options).toEqual([{ mode: "certification" }]);
            expect(file.sourceCode).toBe(context.sourceCode);
            expect(file.languageOptions.sourceType).toBe("module");
            expect(file.settings).toEqual({});
            expect(file.report).toBeTypeOf("function");
            expect(file.reportEffect).toBeTypeOf("function");
            phases.push("before");
            readAfterClose = () => file.physicalFilename;
          }),
          syncVisitors: Visitor.onSync("ImportDeclaration", (node, file) => {
            phases.push("synchronous visitor");
            file.report(Diagnostic.make({ node, message: file.physicalFilename }));
          }),
          visitors: Visitor.onEffect("ImportDeclaration", (node) =>
            Effect.gen(function* () {
              const file = yield* FileContext.FileContext;
              phases.push("effectful visitor");
              yield* file.reportEffect(Diagnostic.make({ node, message: file.filename }));
            }),
          ),
          after: Effect.gen(function* () {
            yield* FileContext.FileContext;
            phases.push("after");
          }),
        };
      }),
  });
  const visitor = Rule.compile(plan).createOnce(context);

  expect(setupFileContextAvailable).toBe(false);
  expect(visitor.before?.()).toBe(true);
  visitor.ImportDeclaration?.(importDecl("effect"));
  visitor.after?.();

  expect(phases).toEqual(createOnceContextContract.fileCallbacks.phases);
  expect(diagnostics.map(({ diagnostic }) => diagnostic.message)).toEqual([
    "/project/src/file.ts",
    "/project/src/file.ts",
  ]);
  expect(readAfterClose).toThrow(FileContext.FileContextUnavailable);
});
