import { Config, Effect, Redacted, Schema } from "effect";

import { ChildCommand } from "./child-command.ts";

/**
 * The values Compose assigns this worktree, injected into every child process.
 *
 * These are parts, never connection strings. The root `.env.schema` composes
 * `DATABASE_URL` and `REDIS_URL` from them, so the shape of a connection string
 * is written in one place. Each key here matches an item that schema declares
 * `@required` with no default — rename one side only and the child stops rather
 * than falling back to a stale default port.
 */
export interface Environment {
  readonly DB_HOST: string;
  readonly DB_PASSWORD: string;
  readonly DB_PORT: string;
  readonly DB_USERNAME: string;
  readonly POSTGRES_PASSWORD: string;
  readonly REDIS_PORT: string;
}

export interface Ports {
  readonly postgres: number;
  readonly redis: number;
}

export class ServicesStartFailed extends Schema.TaggedError<ServicesStartFailed>()(
  "ServicesStartFailed",
  {
    exitCode: Schema.Int,
    message: Schema.String,
  },
) {}

export class ServicePortInvalid extends Schema.TaggedError<ServicePortInvalid>()(
  "ServicePortInvalid",
  {
    exitCode: Schema.Int,
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
    // `Config<T>` is an `Effect<T, ConfigError>`, so `withDefault` narrows the
    // value but never the error channel. The default makes a read failure
    // unreachable here, and a broken config provider is a defect rather than
    // something an operator can act on, so it does not belong in the channel
    // every caller of `start` has to carry.
    const configuredPassword = yield* Config.redacted("POSTGRES_PASSWORD").pipe(
      Config.withDefault(Redacted.make("password")),
      Effect.orDie,
    );
    const password = Redacted.value(configuredPassword) || "password";

    yield* commands
      .run({
        ...compose(cwd, ["up", "-d", "--wait", "--wait-timeout", "60", "postgres", "redis"]),
        environment: { POSTGRES_PASSWORD: password },
      })
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
      // Medusa test-utils enables TLS unless its generated URL contains this
      // literal. The worktree PostgreSQL service does not provide TLS.
      DB_HOST: "localhost",
      // Passed raw. The schema rejects any character that would need
      // percent-encoding, so a password that cannot go into a URL fails at the
      // contract rather than composing into a malformed one.
      DB_PASSWORD: password,
      DB_PORT: String(discovered.postgres),
      DB_USERNAME: "postgres",
      POSTGRES_PASSWORD: password,
      REDIS_PORT: String(discovered.redis),
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
