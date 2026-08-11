import { expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";

const silentOutput = Layer.succeed(Output.Service, Output.Service.of({ write: () => Effect.void }));

const provideLiveChildCommand = <A, E>(
  effect: Effect.Effect<A, E, ChildCommand.Service>,
  outputLayer: Layer.Layer<Output.Service> = silentOutput,
) =>
  effect.pipe(
    Effect.provide(ChildCommand.layer),
    Effect.provide(outputLayer),
    Effect.provide(NodeServices.layer),
  );

it.live("captures child output without losing the exit code", () =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const result = yield* commands.capture({
      executable: process.execPath,
      arguments: ["-e", 'process.stdout.write("ready\\n"); process.stderr.write("warning\\n")'],
    });

    expect(result).toEqual({ exitCode: 0, stderr: "warning\n", stdout: "ready\n" });
  }).pipe(provideLiveChildCommand),
);

it.live("returns the exact nonzero child exit code", () => {
  const events: Array<Output.Event> = [];
  const outputLayer = Layer.succeed(
    Output.Service,
    Output.Service.of({ write: (event) => Effect.sync(() => void events.push(event)) }),
  );

  return Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const error = yield* commands
      .run({
        executable: process.execPath,
        arguments: [
          "-e",
          'process.stdout.write("before failure\\n"); process.stderr.write("bad input\\n"); process.exit(23)',
        ],
      })
      .pipe(Effect.flip);

    expect(error._tag).toBe("CommandFailed");
    expect(error.exitCode).toBe(23);
    if (error._tag === "CommandFailed") {
      expect(error.stdout).toBe("before failure\n");
      expect(error.stderr).toBe("bad input\n");
    }
    expect(events).toContainEqual({
      command: process.execPath,
      event: "child-output",
      stream: "stderr",
      data: "bad input\n",
    });
  }).pipe((effect) => provideLiveChildCommand(effect, outputLayer));
});

it.live("reports a missing executable with exit code 127", () =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const error = yield* commands
      .run({ executable: "mze-command-that-does-not-exist", arguments: [] })
      .pipe(Effect.flip);

    expect(error._tag).toBe("ExecutableMissing");
    expect(error.exitCode).toBe(127);
  }).pipe(provideLiveChildCommand),
);
