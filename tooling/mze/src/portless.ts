import { Effect, Schema } from "effect";

import { ChildCommand } from "./child-command.ts";

export const REQUIRED_VERSION = "0.15.5";
export const INSTALL_COMMAND = `bun add --global portless@${REQUIRED_VERSION}`;

const ROUTE_CONFLICT = '"medusa.mze-store.localhost" is already registered by a running process';
const VERSION_PATTERN = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/;

export class PortlessUnavailable extends Schema.TaggedError<PortlessUnavailable>()(
  "PortlessUnavailable",
  {
    detail: Schema.String,
    exitCode: Schema.Int,
    installCommand: Schema.String,
  },
) {}

export class PortlessVersionMismatch extends Schema.TaggedError<PortlessVersionMismatch>()(
  "PortlessVersionMismatch",
  {
    exitCode: Schema.Int,
    found: Schema.String,
    installCommand: Schema.String,
    required: Schema.String,
  },
) {}

export class PortlessRouteConflict extends Schema.TaggedError<PortlessRouteConflict>()(
  "PortlessRouteConflict",
  {
    exitCode: Schema.Int,
    message: Schema.String,
  },
) {}

export type Error =
  | ChildCommand.Error
  | PortlessRouteConflict
  | PortlessUnavailable
  | PortlessVersionMismatch;

export const checkVersion = Effect.gen(function* () {
  const commands = yield* ChildCommand.Service;
  const result = yield* commands.capture({ executable: "portless", arguments: ["--version"] }).pipe(
    Effect.mapError(
      (error) =>
        new PortlessUnavailable({
          detail: error.command,
          exitCode: error.exitCode,
          installCommand: INSTALL_COMMAND,
        }),
    ),
  );
  const found = `${result.stdout}\n${result.stderr}`.match(VERSION_PATTERN)?.[0];

  if (found !== REQUIRED_VERSION) {
    return yield* new PortlessVersionMismatch({
      exitCode: 1,
      found: found ?? "no version reported",
      installCommand: INSTALL_COMMAND,
      required: REQUIRED_VERSION,
    });
  }

  return found;
});

export const runMedusa = (options: {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;

    yield* commands
      .run({
        executable: "portless",
        arguments: ["medusa.mze-store", "medusa", "develop"],
        cwd: options.cwd,
        environment: options.environment,
      })
      .pipe(
        Effect.catchTag(
          "CommandFailed",
          (error): Effect.Effect<never, ChildCommand.CommandFailed | PortlessRouteConflict> => {
            if (`${error.stdout}\n${error.stderr}`.includes(ROUTE_CONFLICT)) {
              return Effect.fail(
                new PortlessRouteConflict({
                  exitCode: error.exitCode,
                  message:
                    "The shared Medusa URL is in use. Run `bun run mze dev storefront` for a Storefront-only process. Do not use `--force`.",
                }),
              );
            }

            return Effect.fail(error);
          },
        ),
      );
  });

export * as Portless from "./portless.ts";
