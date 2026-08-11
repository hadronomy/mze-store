import { expect, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Services } from "./services.ts";

it.effect("starts healthy services and returns their discovered environment", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);
    const commandLayer = Layer.succeed(
      ChildCommand.Service,
      ChildCommand.Service.of({
        capture: (spec) =>
          Ref.update(calls, (current) => [...current, spec]).pipe(
            Effect.as({
              exitCode: 0,
              stderr: "",
              stdout: spec.arguments.includes("postgres")
                ? "127.0.0.1:49153\n"
                : "127.0.0.1:49154\n",
            }),
          ),
        run: (spec) => Ref.update(calls, (current) => [...current, spec]),
      }),
    );

    const environment = yield* Services.start("/repo").pipe(Effect.provide(commandLayer));
    const recorded = yield* Ref.get(calls);

    expect(recorded[0]).toEqual({
      executable: "docker",
      arguments: ["compose", "up", "-d", "--wait", "--wait-timeout", "60", "postgres", "redis"],
      cwd: "/repo",
    });
    expect(environment).toEqual({
      DATABASE_URL: "postgresql://postgres:password@127.0.0.1:49153/mze-store",
      REDIS_URL: "redis://127.0.0.1:49154",
    });
  }),
);

it.effect("reports recovery commands when service health does not become ready", () =>
  Services.start("/repo").pipe(
    Effect.provide(
      Layer.succeed(
        ChildCommand.Service,
        ChildCommand.Service.of({
          capture: () => Effect.die("capture was not expected"),
          run: () =>
            Effect.fail(
              new ChildCommand.CommandFailed({
                command: "docker compose up",
                exitCode: 17,
                stderr: "services did not become healthy",
                stdout: "",
              }),
            ),
        }),
      ),
    ),
    Effect.flip,
    Effect.map((error) => {
      expect(error._tag).toBe("ServicesStartFailed");
      expect(error.exitCode).toBe(17);
      if (error._tag === "ServicesStartFailed") {
        expect(error.message).toContain("docker compose ps postgres redis");
        expect(error.message).toContain("docker compose logs postgres redis");
      }
    }),
  ),
);
