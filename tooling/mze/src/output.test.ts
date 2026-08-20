import { expect, it } from "@effect/vitest";
import { Effect, Layer, Sink, Stdio, Stream } from "effect";

import { Output } from "./output.ts";

function captureStdio() {
  const stderr: Array<string> = [];
  const stdout: Array<string> = [];
  const writeTo = (target: Array<string>) =>
    Sink.forEach<string | Uint8Array, void, never, never>((chunk) =>
      Effect.sync(() =>
        target.push(chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : chunk),
      ),
    );
  const layer = Layer.succeed(
    Stdio.Stdio,
    Stdio.make({
      args: Effect.succeed([]),
      stderr: () => writeTo(stderr),
      stdin: Stream.empty,
      stdout: () => writeTo(stdout),
    }),
  );

  return { layer, stderr, stdout };
}

it.effect("passes child output through in human mode", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const output = yield* Output.Service;
    yield* output.write({
      command: "medusa",
      data: "ready\n",
      event: "child-output",
      stream: "stdout",
    });

    expect(capture.stdout).toEqual(["ready\n"]);
    expect(capture.stderr).toEqual([]);
  }).pipe(Effect.provide(Layer.provide(Output.layer("human"), capture.layer)));
});

it.effect("renders the event rail without ANSI codes when color is disabled", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const output = yield* Output.Service;
    yield* output.write({ command: "mze dev", event: "started", stream: "stdout" });
    yield* output.write({
      command: "doctor",
      data: { message: "✓ docker: healthy", name: "docker", passed: true },
      event: "message",
      stream: "stdout",
    });
    yield* output.write({
      command: "doctor",
      data: {
        detail: "PostgreSQL and Redis are not both running.",
        message: "✗ services: PostgreSQL and Redis are not both running.",
        name: "services",
        passed: false,
      },
      event: "message",
      stream: "stderr",
    });

    expect(capture.stdout).toEqual(["→ mze dev started\n", "  ✓ docker\n"]);
    expect(capture.stderr).toEqual([
      "  ✗ services\n    PostgreSQL and Redis are not both running.\n",
    ]);
  }).pipe(Effect.provide(Layer.provide(Output.layer("human", { color: false }), capture.layer)));
});

it.effect("colors status marks when the terminal policy enables color", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const output = yield* Output.Service;
    yield* output.write({ command: "mze dev", event: "started", stream: "stdout" });
    yield* output.write({
      command: "doctor",
      data: {
        detail: "Route ownership needs attention.",
        message: "✗ Medusa route ownership: Route ownership needs attention.",
        name: "Medusa route ownership",
        passed: false,
      },
      event: "message",
      stream: "stderr",
    });
    yield* output.write({
      command: "mze dev",
      data: { exitCode: 1, message: "route already owned" },
      event: "failed",
      stream: "stderr",
    });

    expect(capture.stdout[0]).toContain("\u001b[36m→\u001b[39m");
    expect(capture.stderr[0]).toContain("  \u001b[31m✗\u001b[39m");
    expect(capture.stderr[0]).toContain("    \u001b[2mRoute ownership needs attention.\u001b[22m");
    expect(capture.stderr[0]).not.toContain("\u001b[31mMedusa route ownership");
    expect(capture.stderr[1]).toContain("\u001b[31m✗\u001b[39m");
    expect(capture.stderr[1]).not.toContain("\u001b[31mroute already owned");
  }).pipe(Effect.provide(Layer.provide(Output.layer("human", { color: true }), capture.layer)));
});

it.effect("writes versioned NDJSON to the selected stream", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const output = yield* Output.Service;
    yield* output.write({
      command: "services start",
      data: { exitCode: 1, message: "service failed" },
      event: "failed",
      stream: "stderr",
    });

    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toHaveLength(1);
    expect(JSON.parse(capture.stderr[0]!)).toEqual({
      command: "services start",
      data: { exitCode: 1, message: "service failed" },
      event: "failed",
      stream: "stderr",
      time: "1970-01-01T00:00:00.000Z",
      version: 3,
    });
  }).pipe(Effect.provide(Layer.provide(Output.layer("json"), capture.layer)));
});

it.effect("names the phase a chunk of child output came from", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const output = yield* Output.Service;
    yield* output.write({
      command: "vp",
      data: "compiling\n",
      event: "child-output",
      phase: "packages",
      stream: "stdout",
    });
    // A caller outside any phase — most `child-output` writers — tags
    // nothing, and the field must not appear at all rather than show up as
    // `null` for every consumer that never runs inside a phase.
    yield* output.write({
      command: "medusa",
      data: "ready\n",
      event: "child-output",
      stream: "stdout",
    });

    const [tagged, untagged] = capture.stdout.map((line) => JSON.parse(line) as { phase?: string });
    expect(tagged?.phase).toBe("packages");
    expect(untagged).not.toHaveProperty("phase");
  }).pipe(Effect.provide(Layer.provide(Output.layer("json"), capture.layer)));
});

it.effect("records phase events for machine consumers", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const output = yield* Output.Service;
    yield* output.write({
      command: "build",
      data: { elapsedMillis: 1200, phase: "packages" },
      event: "phase-succeeded",
      stream: "stdout",
    });

    expect(JSON.parse(capture.stdout[0]!)).toMatchObject({
      data: { elapsedMillis: 1200, phase: "packages" },
      event: "phase-succeeded",
      version: 3,
    });
  }).pipe(Effect.provide(Layer.provide(Output.layer("json"), capture.layer)));
});

it.effect("leaves phase rows to the renderer in human mode", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const output = yield* Output.Service;
    yield* output.write({
      command: "build",
      data: { phase: "packages" },
      event: "phase-started",
      stream: "stdout",
    });
    yield* output.write({ command: "build", event: "succeeded", stream: "stdout" });

    // Printing the row here as well would duplicate it and corrupt a live frame.
    expect(capture.stdout).toEqual(["✔ build ready\n"]);
  }).pipe(Effect.provide(Layer.provide(Output.layer("human", { color: false }), capture.layer)));
});
