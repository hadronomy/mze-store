import { expect, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Docker } from "./docker.ts";

it.effect("waits for the Docker applications to become ready", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);

    yield* Docker.up("/repo").pipe(
      Effect.provide(
        Layer.succeed(
          ChildCommand.Service,
          ChildCommand.Service.of({
            capture: () => Effect.die("capture was not expected"),
            run: (spec) => Ref.update(calls, (current) => [...current, spec]),
          }),
        ),
      ),
    );

    expect(yield* Ref.get(calls)).toEqual([
      {
        executable: "docker",
        arguments: ["compose", "up", "-d", "--build", "--wait", "--wait-timeout", "180"],
        cwd: "/repo",
      },
    ]);
  }),
);
