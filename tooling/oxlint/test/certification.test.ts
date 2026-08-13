import { expect, it } from "@effect/vitest";
import plugin from "@mze-store/oxlint";
import { Effect, Schema } from "effect";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Diagnostic, FileContext, Rule, Visitor } from "effect-oxlint";
import { createMockContext, importDecl } from "effect-oxlint/testing";

import { runOxlintBaseline } from "~/baseline";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const RootManifest = Schema.Struct({
  devDependencies: Schema.Record(Schema.String, Schema.String),
  packageManager: Schema.String,
  workspaces: Schema.Struct({
    catalog: Schema.Record(Schema.String, Schema.String),
  }),
});
const PackageManifest = Schema.Struct({
  dependencies: Schema.Record(Schema.String, Schema.String),
  devDependencies: Schema.Record(Schema.String, Schema.String),
});
const ViteManifest = Schema.Struct({
  dependencies: Schema.Record(Schema.String, Schema.String),
  version: Schema.String,
});
const VersionManifest = Schema.Struct({ version: Schema.String });
const decodeRootManifest = Schema.decodeUnknownSync(Schema.fromJsonString(RootManifest));
const decodePackageManifest = Schema.decodeUnknownSync(Schema.fromJsonString(PackageManifest));
const decodeViteManifest = Schema.decodeUnknownSync(Schema.fromJsonString(ViteManifest));
const decodeVersionManifest = Schema.decodeUnknownSync(Schema.fromJsonString(VersionManifest));

it("certifies the exact supported version cohort", async () => {
  const [
    rootSource,
    packageSource,
    viteSource,
    oxlintSource,
    pluginsSource,
    typescriptSource,
    mise,
  ] = await Promise.all([
    readFile(join(workspaceRoot, "package.json"), "utf8"),
    readFile(join(import.meta.dirname, "../package.json"), "utf8"),
    readFile(join(workspaceRoot, "node_modules/vite-plus/package.json"), "utf8"),
    readFile(join(workspaceRoot, "node_modules/oxlint/package.json"), "utf8"),
    readFile(join(workspaceRoot, "node_modules/@oxlint/plugins/package.json"), "utf8"),
    readFile(join(workspaceRoot, "node_modules/typescript/package.json"), "utf8"),
    readFile(join(workspaceRoot, "mise.toml"), "utf8"),
  ]);
  const root = decodeRootManifest(rootSource);
  const packageJson = decodePackageManifest(packageSource);
  const vite = decodeViteManifest(viteSource);

  expect(process.versions.node).toBe("24.18.1");
  expect(root.packageManager).toBe("bun@1.3.14");
  expect(mise).toContain(`node = "24.18.1"`);
  expect(mise).toContain(`bun = "1.3.14"`);
  expect(root.devDependencies.effect).toBe("4.0.0-beta.107");
  expect(packageJson.dependencies.effect).toBe("4.0.0-beta.107");
  expect(packageJson.devDependencies["@effect/vitest"]).toBe("4.0.0-beta.107");
  expect(packageJson.dependencies["effect-oxlint"]).toBe("github:hadronomy/effect-oxlint#ef3bfa2");
  expect(packageJson.dependencies["@oxlint/plugins"]).toBe("1.78.0");
  expect(decodeVersionManifest(pluginsSource).version).toBe("1.78.0");
  expect(decodeVersionManifest(oxlintSource).version).toBe("1.78.0");
  expect(vite.version).toBe("0.2.6");
  expect(vite.dependencies["@oxlint/plugins"]).toBe("=1.73.0");
  expect(vite.dependencies.oxlint).toBe("=1.75.0");
  expect(root.workspaces.catalog["vite-plus"]).toBe("0.2.6");
  expect(decodeVersionManifest(typescriptSource).version).toBe("6.0.3");
});

it("certifies the compiler and ESLint compatibility surface", () => {
  const exportedRule = plugin.rules?.["prefer-tilde-imports"];

  expect(Rule.plan).toBeTypeOf("function");
  expect(Rule.compile).toBeTypeOf("function");
  expect(Visitor.onSync).toBeTypeOf("function");
  expect(Visitor.onEffect).toBeTypeOf("function");
  expect(exportedRule).toEqual(
    expect.objectContaining({
      create: expect.any(Function),
      createOnce: expect.any(Function),
    }),
  );
});

it("certifies the createOnce lifecycle and both visitor paths", () => {
  const { context, diagnostics } = createMockContext({
    filename: "/project/src/file.ts",
  });
  const plan = Rule.plan({
    name: "certification",
    meta: Rule.meta({ type: "suggestion", description: "Certification rule" }),
    create: () =>
      Effect.succeed({
        before: Effect.gen(function* () {
          const file = yield* FileContext.FileContext;
          if (file.physicalFilename !== "/project/src/file.ts") {
            throw new Error("physical filename was not available during before");
          }
        }),
        syncVisitors: Visitor.onSync("ImportDeclaration", (node, file) => {
          file.report(Diagnostic.make({ node, message: "sync visitor" }));
        }),
        visitors: Visitor.onEffect("ImportDeclaration", (node) =>
          Effect.gen(function* () {
            const file = yield* FileContext.FileContext;
            yield* file.reportEffect(Diagnostic.make({ node, message: "effect visitor" }));
          }),
        ),
        after: Effect.gen(function* () {
          yield* FileContext.FileContext;
          yield* Effect.void;
        }),
      }),
  });
  const rule = Rule.compile(plan);
  const visitor = rule.createOnce(context);

  expect(plan._tag).toBe("OnceRulePlan");
  expect(visitor.before?.()).toBe(true);
  visitor.ImportDeclaration?.(importDecl("effect"));
  visitor.after?.();
  expect(diagnostics.map(({ diagnostic }) => diagnostic.message)).toEqual([
    "effect visitor",
    "sync visitor",
  ]);
});

it("certifies the real Vite+ lint and fix consumer", { timeout: 120_000 }, async () => {
  const report = await runOxlintBaseline();

  expect(report.behavior).toHaveLength(10);
  expect(report.fix).toMatchObject({
    changedOnFirstRun: true,
    matchesExpectedOutput: true,
    cleanOnSecondRun: true,
  });
});
