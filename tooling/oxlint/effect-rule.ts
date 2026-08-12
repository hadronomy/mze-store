import { Effect, Exit, Layer } from "effect";
import { defineRule, type CreateOnceRule, type RuleMeta } from "@oxlint/plugins";

import { FileContext, type FileContextController, makeController } from "./effect-context";

export type EffectVisitor = Partial<
  Record<string, (node: unknown) => Effect.Effect<void, unknown, FileContext>>
>;

export interface EffectRuleProgram {
  readonly before?: Effect.Effect<boolean | void, unknown, FileContext>;
  readonly after?: Effect.Effect<void, unknown, FileContext>;
  readonly visitors: EffectVisitor;
}

export interface EffectRuleDefinition<Requirements = never> {
  readonly meta?: RuleMeta;
  readonly setup: Effect.Effect<EffectRuleProgram, unknown, Requirements>;
  readonly layer?: Layer.Layer<Requirements, unknown, never>;
}

export class RuleSetupError extends Error {
  readonly _tag = "RuleSetupError";

  constructor(readonly causeValue: unknown) {
    super("Effect oxlint rule setup failed");
  }
}

export class RuleExecutionError extends Error {
  readonly _tag = "RuleExecutionError";

  constructor(
    readonly phase: "before" | "visit" | "after",
    readonly causeValue: unknown,
  ) {
    super(`Effect oxlint rule ${phase} failed`);
  }
}

function failureValue(exit: Exit.Exit<unknown, unknown>): unknown {
  return Exit.isFailure(exit) ? exit.cause : undefined;
}

function runSetup<Requirements>(definition: EffectRuleDefinition<Requirements>): EffectRuleProgram {
  const setup = definition.layer
    ? Effect.provide(definition.setup, definition.layer)
    : definition.setup;
  const exit = Effect.runSyncExit(setup as Effect.Effect<EffectRuleProgram, unknown, never>);

  if (Exit.isFailure(exit)) {
    throw new RuleSetupError(failureValue(exit));
  }

  return exit.value;
}

function runFileEffect<A>(
  controller: FileContextController,
  effect: Effect.Effect<A, unknown, FileContext>,
): A {
  const exit = Effect.runSyncExit(
    effect.pipe(Effect.provideService(FileContext, controller.service)),
  );

  if (Exit.isFailure(exit)) {
    throw failureValue(exit);
  }

  return exit.value;
}

export const Rule = {
  defineOnce<Requirements = never>(definition: EffectRuleDefinition<Requirements>): CreateOnceRule {
    return defineRule({
      meta: definition.meta,
      createOnce(context) {
        const program = runSetup(definition);
        const controller = makeController(context);

        const runLifecycle = <A>(
          phase: "before" | "after",
          effect: Effect.Effect<A, unknown, FileContext> | undefined,
        ): A | undefined => {
          if (!effect) {
            return undefined;
          }

          try {
            return runFileEffect(controller, effect);
          } catch (error) {
            throw new RuleExecutionError(phase, error);
          }
        };

        const visitors: Record<string, (node: unknown) => void> = {};

        for (const [key, handler] of Object.entries(program.visitors)) {
          if (handler) {
            visitors[key] = (node) => {
              try {
                runFileEffect(controller, handler(node));
              } catch (error) {
                throw new RuleExecutionError("visit", error);
              }
            };
          }
        }

        return {
          ...visitors,
          before() {
            controller.before();

            try {
              return runLifecycle("before", program.before) !== false;
            } catch (error) {
              controller.close();
              throw error;
            }
          },
          after() {
            try {
              runLifecycle("after", program.after);
            } finally {
              controller.close();
            }
          },
        };
      },
    });
  },
};
