import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Diagnostic, FileContext, Rule, Visitor } from "effect-oxlint";
import { createMockContext, importDecl } from "effect-oxlint/testing";

const PackageManifest = Schema.Struct({
  devDependencies: Schema.Record(Schema.String, Schema.String),
});

it("certifies the fork pin and public compiler surface", async () => {
  const packageJson = Schema.decodeUnknownSync(Schema.fromJsonString(PackageManifest))(
    await readFile(join(import.meta.dirname, "../../package.json"), "utf8"),
  );

  expect(packageJson.devDependencies["effect-oxlint"]).toMatch(
    /^github:hadronomy\/effect-oxlint#[0-9a-f]{7,40}$/,
  );
  expect(Rule.plan).toBeTypeOf("function");
  expect(Rule.compile).toBeTypeOf("function");
  expect(Visitor.onSync).toBeTypeOf("function");
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
