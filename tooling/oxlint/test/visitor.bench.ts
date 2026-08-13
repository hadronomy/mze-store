import { afterAll, beforeAll, bench, describe } from "@effect/vitest";
import { Effect } from "effect";
import { FileContext, Rule, Visitor } from "effect-oxlint";
import { createMockContext, importDecl } from "effect-oxlint/testing";

import { runOxlintBaseline } from "~/baseline";

const callbacksPerBatch = 10_000;
const node = importDecl("effect");
let directVisits = 0;
let effectfulVisits = 0;

const directContext = createMockContext({ filename: "/project/direct.ts" }).context;
const effectfulContext = createMockContext({ filename: "/project/effectful.ts" }).context;
const directVisitor = Rule.compile(
  Rule.plan({
    name: "direct-benchmark",
    meta: Rule.meta({ type: "suggestion", description: "Direct benchmark" }),
    create: () =>
      Effect.succeed({
        syncVisitors: Visitor.onSync("ImportDeclaration", (_node, file) => {
          if (file.physicalFilename.length > 0) {
            directVisits += 1;
          }
        }),
      }),
  }),
).createOnce(directContext);
const effectfulVisitor = Rule.compile(
  Rule.plan({
    name: "effectful-benchmark",
    meta: Rule.meta({ type: "suggestion", description: "Effectful benchmark" }),
    create: () =>
      Effect.succeed({
        visitors: Visitor.onEffect("ImportDeclaration", () =>
          Effect.gen(function* () {
            const file = yield* FileContext.FileContext;
            if (file.physicalFilename.length > 0) {
              effectfulVisits += 1;
            }
          }),
        ),
      }),
  }),
).createOnce(effectfulContext);
const directHandler = directVisitor.ImportDeclaration;
const effectfulHandler = effectfulVisitor.ImportDeclaration;

if (!directHandler || !effectfulHandler) {
  throw new Error("The benchmark visitors did not compile.");
}

const runDirectHandler = directHandler;
const runEffectfulHandler = effectfulHandler;

function runDirectBatch(): void {
  for (let index = 0; index < callbacksPerBatch; index += 1) {
    runDirectHandler(node);
  }
}

function runEffectfulBatch(): void {
  for (let index = 0; index < callbacksPerBatch; index += 1) {
    runEffectfulHandler(node);
  }
}

beforeAll(() => {
  if (directVisitor.before?.() !== true || effectfulVisitor.before?.() !== true) {
    throw new Error("The benchmark visitors did not start.");
  }
});

afterAll(() => {
  directVisitor.after?.();
  effectfulVisitor.after?.();

  if (directVisits === 0 || effectfulVisits === 0) {
    throw new Error("The benchmark visitors did not run.");
  }
});

describe("effect-oxlint visitor callbacks", () => {
  bench("Visitor.onSync (10,000 callbacks)", runDirectBatch, {
    iterations: 20,
    time: 500,
    warmupIterations: 5,
    warmupTime: 100,
  });

  bench("Visitor.onEffect (10,000 callbacks)", runEffectfulBatch, {
    iterations: 20,
    time: 500,
    warmupIterations: 5,
    warmupTime: 100,
  });
});

describe("real Vite+ consumer", () => {
  bench(
    "run the real Vite+ consumer fixture",
    async () => {
      await runOxlintBaseline();
    },
    {
      iterations: 3,
      time: 0,
      warmupIterations: 0,
      warmupTime: 0,
    },
  );
});
