import { Context, Effect, Layer } from "effect";
import type { Context as OxlintContext, ESTree } from "@oxlint/plugins";
import { expect, test } from "vite-plus/test";

import { FileContext } from "./effect-context";
import { Rule, RuleExecutionError, RuleSetupError } from "./effect-rule";

class StaticCounter extends Context.Service<StaticCounter, { readonly value: number }>()(
  "@mze-store/oxlint/StaticCounter",
) {}

function fakeContext(): OxlintContext {
  let filename = "/repo/one.ts";

  return {
    get id() {
      return "hadronomy/test";
    },
    get options() {
      return [];
    },
    get filename() {
      return filename;
    },
    get physicalFilename() {
      return filename;
    },
    get cwd() {
      return "/repo";
    },
    get sourceCode() {
      return {};
    },
    report() {},
  } as OxlintContext;
}

test("defineOnce runs static setup once and provides FileContext to visitors", () => {
  let setupCalls = 0;
  let seenStaticValue = 0;
  let visitorCalls = 0;

  const rule = Rule.defineOnce({
    layer: Layer.succeed(StaticCounter, { value: 42 }),
    setup: Effect.gen(function* () {
      setupCalls += 1;
      const counter = yield* StaticCounter;
      seenStaticValue = counter.value;

      return {
        visitors: {
          ImportDeclaration: Effect.fn(function* (_node: unknown) {
            visitorCalls += 1;
            const file = yield* FileContext;
            expect(file.use((frame) => frame.filename)).toBe("/repo/one.ts");
          }),
        },
      };
    }),
  });

  const visitor = rule.createOnce!(fakeContext());
  visitor.before?.();
  visitor.ImportDeclaration?.({} as ESTree.ImportDeclaration);
  visitor.after?.();

  expect(setupCalls).toBe(1);
  expect(seenStaticValue).toBe(42);
  expect(visitorCalls).toBe(1);
});

test("defineOnce preserves before skip and still runs after", () => {
  let visits = 0;
  let afterCalls = 0;

  const rule = Rule.defineOnce({
    setup: Effect.succeed({
      before: Effect.succeed(false),
      after: Effect.sync(() => {
        afterCalls += 1;
      }).pipe(Effect.provideService(FileContext, {} as never)),
      visitors: {
        ImportDeclaration: Effect.sync(() => {
          visits += 1;
        }).pipe(Effect.provideService(FileContext, {} as never)),
      },
    }),
  });
  const visitor = rule.createOnce!(fakeContext());

  expect(visitor.before?.()).toBe(false);
  visitor.after?.();
  expect(visits).toBe(0);
  expect(afterCalls).toBe(1);
});

test("defineOnce wraps setup and visitor failures at the host boundary", () => {
  const setupFailure = Rule.defineOnce({
    setup: Effect.fail("setup failed"),
  });

  expect(() => setupFailure.createOnce!(fakeContext())).toThrow(RuleSetupError);

  const visitorFailure = Rule.defineOnce({
    setup: Effect.succeed({
      visitors: {
        ImportDeclaration: Effect.fail("visit failed"),
      },
    }),
  });
  const visitor = visitorFailure.createOnce!(fakeContext());
  visitor.before?.();

  expect(() => visitor.ImportDeclaration?.({} as ESTree.ImportDeclaration)).toThrow(
    RuleExecutionError,
  );
  visitor.after?.();
});
