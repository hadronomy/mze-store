import { expect, it } from "@effect/vitest";
import { Effect, Layer, Sink, Stdio, Stream } from "effect";

import { Output } from "./output.ts";

function captureStdio() {
  const stderr: Array<string> = [];
  const stdout: Array<string> = [];
  const writeTo = (target: Array<string>) =>
    Sink.forEach<string | Uint8Array, void, never, never>((chunk) =>
      Effect.sync(() =>
        target.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)),
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
  }).pipe(Effect.provide(Output.layer("human")), Effect.provide(capture.layer));
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
      command: "mze dev",
      data: { exitCode: 1, message: "route already owned" },
      event: "failed",
      stream: "stderr",
    });

    expect(capture.stdout).toEqual(["→ mze dev started\n", "✓ docker: healthy\n"]);
    expect(capture.stderr).toEqual(["✗ mze dev failed (exit 1) — route already owned\n"]);
  }).pipe(Effect.provide(Output.layer("human", { color: false })), Effect.provide(capture.layer));
});

it.effect("colors status marks when the terminal policy enables color", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const output = yield* Output.Service;
    yield* output.write({ command: "mze dev", event: "started", stream: "stdout" });
    yield* output.write({
      command: "mze dev",
      data: { exitCode: 1, message: "route already owned" },
      event: "failed",
      stream: "stderr",
    });

    expect(capture.stdout[0]).toContain("\u001b[36m→\u001b[39m");
    expect(capture.stderr[0]).toContain("\u001b[31m✗\u001b[39m");
    expect(capture.stderr[0]).toContain("route already owned");
  }).pipe(Effect.provide(Output.layer("human", { color: true })), Effect.provide(capture.layer));
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
      version: 1,
    });
  }).pipe(Effect.provide(Output.layer("json")), Effect.provide(capture.layer));
});
