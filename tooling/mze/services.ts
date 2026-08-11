import { Effect, Schema } from "effect";

import { ChildCommand } from "./child-command.ts";

export interface Environment {
  readonly DATABASE_URL: string;
  readonly REDIS_URL: string;
}

export interface Ports {
  readonly postgres: number;
  readonly redis: number;
}

export class ServicesStartFailed extends Schema.TaggedError<ServicesStartFailed>()(
  "ServicesStartFailed",
  {
    exitCode: Schema.Number,
    message: Schema.String,
  },
) {}

export class ServicePortInvalid extends Schema.TaggedError<ServicePortInvalid>()(
  "ServicePortInvalid",
  {
    exitCode: Schema.Number,
    output: Schema.String,
    service: Schema.String,
  },
) {}

const compose = (cwd: string, arguments_: ReadonlyArray<string>): ChildCommand.Spec => ({
  executable: "docker",
  arguments: ["compose", ...arguments_],
  cwd,
});

const readPort = (cwd: string, service: "postgres" | "redis", containerPort: string) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const result = yield* commands.capture(compose(cwd, ["port", service, containerPort]));
    const port = result.stdout.trim().match(/:(\d+)$/)?.[1];

    if (port === undefined) {
      return yield* new ServicePortInvalid({
        exitCode: 1,
        output: result.stdout,
        service,
      });
    }

    return Number(port);
  });

export const ports = (cwd: string) =>
  Effect.gen(function* () {
    const postgres = yield* readPort(cwd, "postgres", "5432");
    const redis = yield* readPort(cwd, "redis", "6379");

    return { postgres, redis } satisfies Ports;
  });

export const start = (cwd: string) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;

    yield* commands
      .run(compose(cwd, ["up", "-d", "--wait", "--wait-timeout", "60", "postgres", "redis"]))
      .pipe(
        Effect.catchTag(
          "CommandFailed",
          (error): Effect.Effect<never, ServicesStartFailed> =>
            Effect.fail(
              new ServicesStartFailed({
                exitCode: error.exitCode,
                message:
                  "PostgreSQL or Redis did not become healthy within 60 seconds. The services remain running. Inspect them with `docker compose ps postgres redis` and `docker compose logs postgres redis`.",
              }),
            ),
        ),
      );

    const discovered = yield* ports(cwd);

    return {
      DATABASE_URL: `postgresql://postgres:password@127.0.0.1:${discovered.postgres}/mze-store`,
      REDIS_URL: `redis://127.0.0.1:${discovered.redis}`,
    } satisfies Environment;
  });

export const stop = (cwd: string) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    yield* commands.run(compose(cwd, ["stop", "postgres", "redis"]));
  });

export const status = (cwd: string) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    yield* commands.run(compose(cwd, ["ps", "postgres", "redis"]));
  });

export * as Services from "./services.ts";
