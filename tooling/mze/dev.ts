import { Effect, Path, Schema } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Portless } from "./portless.ts";
import { Services } from "./services.ts";

export type Target = "all" | "storefront";

export class UnsupportedPlatform extends Schema.TaggedError<UnsupportedPlatform>()(
  "UnsupportedPlatform",
  {
    exitCode: Schema.Number,
    platform: Schema.String,
  },
) {}

export class DevelopmentProcessExited extends Schema.TaggedError<DevelopmentProcessExited>()(
  "DevelopmentProcessExited",
  {
    exitCode: Schema.Number,
    process: Schema.String,
  },
) {}

const supervise = <R>(process: string, effect: Effect.Effect<void, Portless.Error, R>) =>
  effect.pipe(
    Effect.catchTag("CommandFailed", (error) =>
      Effect.fail(
        new DevelopmentProcessExited({
          exitCode: error.exitCode,
          process,
        }),
      ),
    ),
    Effect.andThen(Effect.fail(new DevelopmentProcessExited({ exitCode: 1, process }))),
  );

export const run = (options: {
  readonly cwd: string;
  readonly platform: string;
  readonly target: Target;
}) =>
  Effect.gen(function* () {
    if (options.platform !== "darwin" && options.platform !== "linux") {
      return yield* new UnsupportedPlatform({ exitCode: 1, platform: options.platform });
    }

    const commands = yield* ChildCommand.Service;
    const path = yield* Path.Path;

    yield* Portless.checkVersion;
    const environment = yield* Services.start(options.cwd);
    yield* commands.run({
      executable: "vp",
      arguments: ["run", "--filter", "@mze-store/env", "--filter", "@mze-store/territory", "build"],
      cwd: options.cwd,
    });

    const storefront = supervise(
      "Storefront",
      commands.run({
        executable: "portless",
        arguments: ["run", "--name", "storefront.mze-store", "vp", "dev"],
        cwd: path.join(options.cwd, "apps/storefront"),
        environment,
      }),
    );

    if (options.target === "storefront") {
      return yield* storefront;
    }

    const medusa = supervise(
      "Medusa",
      Portless.runMedusa({
        cwd: path.join(options.cwd, "apps/medusa"),
        environment,
      }),
    );

    yield* Effect.all([storefront, medusa], {
      concurrency: "unbounded",
      discard: true,
    });
  });

export * as Dev from "./dev.ts";
