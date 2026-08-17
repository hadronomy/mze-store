import { Cause, Effect, FileSystem, Path, Schema } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";
import { Portless } from "./portless.ts";
import { ServicePortInvalid } from "./services.ts";

interface Check {
  readonly detail?: string;
  readonly name: string;
  readonly passed: boolean;
}

/**
 * A single failed check.
 *
 * This never leaves the module: `inspect` catches every one of these and turns
 * it into a Check row, and `run` reports the whole set as one DoctorFailed. It
 * is deliberately not exported, so it cannot be mistaken for a failure the
 * reporter has to render.
 */
class DoctorCheckFailed extends Schema.TaggedError<DoctorCheckFailed>()("DoctorCheckFailed", {
  detail: Schema.String,
}) {}

export class DoctorFailed extends Schema.TaggedError<DoctorFailed>()("DoctorFailed", {
  exitCode: Schema.Number,
  failures: Schema.Array(Schema.String),
}) {}

const CheckFailureSchema = Schema.Union([
  ChildCommand.CommandFailed,
  ChildCommand.CommandExecutionFailed,
  ChildCommand.ExecutableMissing,
  DoctorCheckFailed,
  Portless.PortlessUnavailable,
  Portless.PortlessVersionMismatch,
  ServicePortInvalid,
]);
type CheckFailure = typeof CheckFailureSchema.Type;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function failureDetail(name: string, error: CheckFailure | Error | string): string {
  const failure = Schema.is(CheckFailureSchema)(error) ? error : undefined;

  switch (failure?._tag) {
    case "CommandFailed": {
      const output = nonEmpty(failure.stderr) ?? nonEmpty(failure.stdout);
      return output
        ? `Command \`${failure.command}\` failed with exit code ${failure.exitCode}: ${output}`
        : `Command \`${failure.command}\` failed with exit code ${failure.exitCode}.`;
    }
    case "CommandExecutionFailed": {
      const description = nonEmpty(failure.description) ?? "No execution detail was available.";
      return `Could not run \`${failure.command}\`: ${description}`;
    }
    case "ExecutableMissing":
      return `Required executable not found: \`${failure.command}\`.`;
    case "DoctorCheckFailed":
      return nonEmpty(failure.detail) ?? `The ${name} check failed without a detail.`;
    case "PortlessUnavailable":
      return `Portless ${failure.detail} is unavailable. Install it with \`${failure.installCommand}\`.`;
    case "PortlessVersionMismatch":
      return `Portless ${failure.required} is required; found ${failure.found}. Install it with \`${failure.installCommand}\`.`;
    case "ServicePortInvalid": {
      const output = nonEmpty(failure.output) ?? "Docker returned no output.";
      return `Docker returned an invalid port for ${failure.service}: ${output}`;
    }
    default:
      return error instanceof Error && nonEmpty(error.message)
        ? error.message.trim()
        : `The ${name} check failed without a detail.`;
  }
}

const inspect = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Check, E, R> =>
  Effect.matchCauseEffect(effect, {
    onFailure: (cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }

      const error = Cause.squash(cause);
      const detailInput =
        Schema.is(CheckFailureSchema)(error) || error instanceof Error ? error : String(error);
      return Effect.succeed({
        detail: failureDetail(name, detailInput),
        name,
        passed: false,
      });
    },
    onSuccess: () => Effect.succeed({ name, passed: true }),
  });

const requireValue = (condition: boolean, detail: string) =>
  condition ? Effect.void : Effect.fail(new DoctorCheckFailed({ detail }));

const SHARED_MEDUSA_HOST = "medusa.mze-store.localhost";

const servicesHealthy = (output: string): boolean => {
  try {
    const values = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const parsed: unknown = JSON.parse(line);
        return Array.isArray(parsed) ? parsed : [parsed];
      });

    return ["postgres", "redis"].every((service) =>
      values.some(
        (value) =>
          Schema.is(Schema.Struct({ Health: Schema.String, Service: Schema.String }))(value) &&
          value.Service === service &&
          value.Health === "healthy",
      ),
    );
  } catch {
    return false;
  }
};

const sharedRouteAvailable = (output: string) => {
  const route = output.split("\n").find((line) => line.includes(`://${SHARED_MEDUSA_HOST}`));
  if (route === undefined) {
    return Effect.void;
  }

  const owner = route.match(/\((?:pid (\d+)|alias)\)/)?.[0] ?? "an unknown owner";
  return Effect.fail(
    new DoctorCheckFailed({
      detail: `${SHARED_MEDUSA_HOST} is owned by ${owner}. Use \`bun run mze dev storefront\` or stop that process.`,
    }),
  );
};

export const run = (options: {
  readonly cwd: string;
  readonly nodeVersion: string;
  readonly platform: string;
}) =>
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
    const portlessRoutes = commands.capture({
      executable: "portless",
      arguments: ["doctor"],
    });
    const routeOwnership = commands
      .capture({ executable: "portless", arguments: ["list"] })
      .pipe(Effect.flatMap((result) => sharedRouteAvailable(result.stdout)));
    const serviceHealth = commands
      .capture({
        executable: "docker",
        arguments: ["compose", "ps", "--format", "json", "postgres", "redis"],
        cwd: options.cwd,
      })
      .pipe(
        Effect.flatMap((result) =>
          requireValue(
            servicesHealthy(result.stdout),
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
            options.nodeVersion === "24.18.1",
            `Node 24.18.1 is required; found ${options.nodeVersion}.`,
          ),
        ),
        inspect("bun", bunVersion),
        inspect("docker", docker),
        inspect("portless", Portless.checkVersion),
        inspect("portless health", portlessRoutes),
        inspect("Medusa route ownership", routeOwnership),
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
          detail: check.detail,
          message: `${check.passed ? "✓" : "✗"} ${check.name}${check.detail === undefined ? "" : `: ${check.detail}`}`,
          name: check.name,
          passed: check.passed,
        },
        event: "message",
        stream: "stdout",
      });
    }

    const failures = checks.filter((check) => !check.passed).map((check) => check.name);
    if (failures.length > 0) {
      return yield* new DoctorFailed({ exitCode: 1, failures });
    }
  });

export * as Doctor from "./doctor.ts";
