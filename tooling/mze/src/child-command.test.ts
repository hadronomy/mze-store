import { expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, FileSystem, Layer, Path, Schedule } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";

const silentOutput = Layer.succeed(Output.Service, Output.Service.of({ write: () => Effect.void }));

const provideLiveChildCommand = <A, E>(
  effect: Effect.Effect<A, E, ChildCommand.Service | FileSystem.FileSystem | Path.Path>,
  outputLayer: Layer.Layer<Output.Service> = silentOutput,
) =>
  effect.pipe(
    Effect.provide(
      Layer.provide(ChildCommand.layer, Layer.mergeAll(outputLayer, NodeServices.layer)).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
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

it.live("sends SIGTERM when output paths contain code separators and replacement tokens", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commands = yield* ChildCommand.Service;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "mze-process-test-" });
      const pidFile = path.join(directory, `grandchild-;'"$&.pid`);
      const signalFile = path.join(directory, `signal-;'"$&.txt`);
      const script = [
        'const { spawn } = require("node:child_process")',
        'const { writeFileSync } = require("node:fs")',
        "const pidFile = process.env.MZE_PID_FILE",
        "const signalFile = process.env.MZE_SIGNAL_FILE",
        'if (!pidFile || !signalFile) throw new Error("Missing child process paths")',
        `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })`,
        'process.on("SIGTERM", () => { writeFileSync(signalFile, "SIGTERM"); process.exit(0) })',
        "writeFileSync(pidFile, String(child.pid))",
        "setInterval(() => {}, 1000)",
      ].join(";");
      const fiber = yield* commands
        .run({
          executable: process.execPath,
          arguments: ["-e", script],
          environment: {
            MZE_PID_FILE: pidFile,
            MZE_SIGNAL_FILE: signalFile,
          },
        })
        .pipe(Effect.forkChild);
      const waitUntil = (predicate: Effect.Effect<boolean, unknown>) =>
        predicate.pipe(
          Effect.flatMap((ready) => (ready ? Effect.void : Effect.fail("not ready"))),
          Effect.retry({ schedule: Schedule.spaced("20 millis"), times: 250 }),
        );

      yield* waitUntil(fs.exists(pidFile));
      const grandchildPid = Number((yield* fs.readFileString(pidFile)).trim());
      yield* Fiber.interrupt(fiber);
      yield* waitUntil(fs.exists(signalFile));
      yield* waitUntil(
        Effect.sync(() => {
          try {
            process.kill(grandchildPid, 0);
            return false;
          } catch {
            return true;
          }
        }),
      );

      expect(yield* fs.readFileString(signalFile)).toBe("SIGTERM");
    }),
  ).pipe(provideLiveChildCommand),
);
