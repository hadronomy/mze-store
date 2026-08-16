import { expect, it } from "@effect/vitest";
import { ConfigProvider, Deferred, Effect, Layer, Path, Ref } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Dev } from "./dev.ts";

it.effect("starts a Storefront with discovered service ports", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);
    const commands = Layer.succeed(
      ChildCommand.Service,
      ChildCommand.Service.of({
        capture: (spec) =>
          Ref.update(calls, (current) => [...current, spec]).pipe(
            Effect.as({
              exitCode: 0,
              stderr: "",
              stdout:
                spec.executable === "portless"
                  ? "0.15.5\n"
                  : spec.arguments.includes("postgres")
                    ? "127.0.0.1:41001\n"
                    : "127.0.0.1:41002\n",
            }),
          ),
        run: (spec) => Ref.update(calls, (current) => [...current, spec]),
      }),
    );

    yield* Dev.run({ cwd: "/repo", platform: "darwin", target: "storefront" }).pipe(
      Effect.provide(commands),
      Effect.provide(Path.layer),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} })),
      Effect.ignore,
    );
    const recorded = yield* Ref.get(calls);
    const storefront = recorded.find(
      (spec) => spec.executable === "portless" && spec.arguments[0] === "run",
    );

    expect(storefront).toEqual({
      executable: "portless",
      arguments: ["run", "--name", "storefront.mze-store", "vp", "dev"],
      cwd: "/repo/apps/storefront",
      environment: {
        DB_HOST: "localhost",
        DB_PASSWORD: "password",
        DB_PORT: "41001",
        DB_USERNAME: "postgres",
        POSTGRES_PASSWORD: "password",
        REDIS_PORT: "41002",
      },
    });
    expect(recorded.some((spec) => spec.arguments.includes("medusa.mze-store"))).toBe(false);
  }),
);

it.effect("rejects Windows before it starts a process", () =>
  Dev.run({ cwd: "/repo", platform: "win32", target: "all" }).pipe(
    Effect.provide(
      Layer.succeed(
        ChildCommand.Service,
        ChildCommand.Service.of({
          capture: () => Effect.die("capture was not expected"),
          run: () => Effect.die("run was not expected"),
        }),
      ),
    ),
    Effect.provide(Path.layer),
    Effect.flip,
    Effect.map((error) => {
      expect(error._tag).toBe("UnsupportedPlatform");
      expect(error.exitCode).toBe(1);
    }),
  ),
);

it.effect("maps a failed Storefront command to its development process", () =>
  Effect.gen(function* () {
    const commands = ChildCommand.Service.of({
      capture: (spec) =>
        Effect.succeed({
          exitCode: 0,
          stderr: "",
          stdout: spec.executable === "portless" ? "0.15.5\n" : "127.0.0.1:41001\n",
        }),
      run: (spec) =>
        spec.executable === "portless" && spec.arguments[0] === "run"
          ? Effect.fail(
              new ChildCommand.CommandFailed({
                command: "portless run",
                exitCode: 23,
                stderr: "",
                stdout: "",
              }),
            )
          : Effect.void,
    });
    const error = yield* Dev.run({ cwd: "/repo", platform: "darwin", target: "storefront" }).pipe(
      Effect.provideService(ChildCommand.Service, commands),
      Effect.provide(Path.layer),
      Effect.flip,
    );

    expect(error._tag).toBe("DevelopmentProcessExited");
    if (error._tag === "DevelopmentProcessExited") {
      expect(error.exitCode).toBe(23);
      expect(error.process).toBe("Storefront");
    }
  }),
);

it.effect("interrupts the sibling when a development process exits", () =>
  Effect.gen(function* () {
    const bothStarted = yield* Deferred.make<void>();
    const medusaInterrupted = yield* Deferred.make<void>();
    const started = yield* Ref.make(0);
    const commands = ChildCommand.Service.of({
      capture: (spec) =>
        Effect.succeed({
          exitCode: 0,
          stderr: "",
          stdout: spec.executable === "portless" ? "0.15.5\n" : "127.0.0.1:41001\n",
        }),
      run: (spec) => {
        if (spec.executable !== "portless") {
          return Effect.void;
        }

        const storefront = spec.arguments[0] === "run";
        return Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(started, (value) => value + 1);
          if (count === 2) {
            yield* Deferred.succeed(bothStarted, undefined);
          }

          if (storefront) {
            yield* Deferred.await(bothStarted);
            return yield* Effect.fail(
              new ChildCommand.CommandFailed({
                command: "portless run",
                exitCode: 23,
                stderr: "",
                stdout: "",
              }),
            );
          }

          yield* Deferred.await(medusaInterrupted);
        }).pipe(
          Effect.onInterrupt(() =>
            storefront ? Effect.void : Deferred.succeed(medusaInterrupted, undefined),
          ),
        );
      },
    });

    const error = yield* Dev.run({ cwd: "/repo", platform: "darwin", target: "all" }).pipe(
      Effect.provideService(ChildCommand.Service, commands),
      Effect.provide(Path.layer),
      Effect.flip,
    );

    expect(error._tag).toBe("DevelopmentProcessExited");
    if (error._tag === "DevelopmentProcessExited") {
      expect(error.exitCode).toBe(23);
      expect(error.process).toBe("Storefront");
    }
    expect(yield* Deferred.isDone(medusaInterrupted)).toBe(true);
  }),
);
