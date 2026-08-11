import { Cause, Effect, Exit, FileSystem, Path, Schema } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";
import { Portless } from "./portless.ts";

interface Check {
  readonly detail?: string;
  readonly name: string;
  readonly passed: boolean;
}

export class DoctorCheckFailed extends Schema.TaggedError<DoctorCheckFailed>()(
  "DoctorCheckFailed",
  {
    detail: Schema.String,
  },
) {}

export class DoctorFailed extends Schema.TaggedError<DoctorFailed>()("DoctorFailed", {
  exitCode: Schema.Number,
  failures: Schema.Array(Schema.String),
}) {}

const inspect = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
  Effect.exit(effect).pipe(
    Effect.map((exit): Check => {
      if (Exit.isSuccess(exit)) {
        return { name, passed: true };
      }

      const error = Cause.squash(exit.cause);
      return {
        detail: error instanceof Error ? error.message : String(error),
        name,
        passed: false,
      };
    }),
  );

const requireValue = (condition: boolean, detail: string) =>
  condition ? Effect.void : Effect.fail(new DoctorCheckFailed({ detail }));

export const run = (options: { readonly cwd: string; readonly platform: string }) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const fs = yield* FileSystem.FileSystem;
    const output = yield* Output.Service;
    const path = yield* Path.Path;

    const bunVersion = commands
      .capture({ executable: "bun", arguments: ["--version"] })
      .pipe(
        Effect.flatMap((result) =>
          requireValue(result.stdout.trim() === "1.3.14", "Bun 1.3.14 is required."),
        ),
      );
    const docker = commands.capture({ executable: "docker", arguments: ["--version"] });
    const serviceHealth = commands
      .capture({
        executable: "docker",
        arguments: ["compose", "ps", "--format", "json", "postgres", "redis"],
        cwd: options.cwd,
      })
      .pipe(
        Effect.flatMap((result) =>
          requireValue(
            result.stdout.includes("postgres") &&
              result.stdout.includes("redis") &&
              !result.stdout.includes('"Health":"unhealthy"'),
            "PostgreSQL and Redis are not both running.",
          ),
        ),
      );
    const checks = yield* Effect.all(
      [
        inspect(
          "platform",
          requireValue(
            options.platform === "darwin" || options.platform === "linux",
            `Unsupported platform: ${options.platform}`,
          ),
        ),
        inspect(
          "node",
          requireValue(
            process.version === "v24.18.1",
            `Node 24.18.1 is required; found ${process.version}.`,
          ),
        ),
        inspect("bun", bunVersion),
        inspect("docker", docker),
        inspect("portless", Portless.checkVersion),
        inspect(
          "storefront environment",
          fs
            .exists(path.join(options.cwd, "apps/storefront/.env"))
            .pipe(
              Effect.flatMap((exists) => requireValue(exists, "apps/storefront/.env is missing.")),
            ),
        ),
        inspect(
          "medusa environment",
          fs
            .exists(path.join(options.cwd, "apps/medusa/.env"))
            .pipe(Effect.flatMap((exists) => requireValue(exists, "apps/medusa/.env is missing."))),
        ),
        inspect("services", serviceHealth),
      ],
      { concurrency: "unbounded" },
    );

    for (const check of checks) {
      yield* output.write({
        command: "doctor",
        data: {
          message: `${check.passed ? "✓" : "✗"} ${check.name}${check.detail === undefined ? "" : `: ${check.detail}`}`,
          name: check.name,
          passed: check.passed,
        },
        event: "message",
        stream: check.passed ? "stdout" : "stderr",
      });
    }

    const failures = checks.filter((check) => !check.passed).map((check) => check.name);
    if (failures.length > 0) {
      return yield* new DoctorFailed({ exitCode: 1, failures });
    }
  });

export * as Doctor from "./doctor.ts";
