import { expect, it } from "@effect/vitest";
import ansiEscapes from "ansi-escapes";
import { Chalk } from "chalk";
import { Effect, Layer, Sink, Stdio, Stream } from "effect";
import * as TestClock from "effect/testing/TestClock";

import { Renderer } from "./renderer.ts";
import { TerminalCapabilities } from "./terminal-capabilities.ts";

const colors = new Chalk({ level: 0 });

const makeRow = (overrides: Partial<Renderer.Row> & { readonly name: string }): Renderer.Row => ({
  buffer: "",
  status: "pending",
  subtasks: [],
  tail: "",
  ...overrides,
});

const render = (rows: ReadonlyArray<Renderer.Row>, columns = 60) =>
  Renderer.frame({ pending: "", rows, spinner: 0 }, { colors, columns });

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

it("renders one line per row, marked by status", () => {
  expect(
    render([
      makeRow({ elapsedMillis: 400, name: "oxlint plugin", status: "succeeded" }),
      makeRow({ elapsedMillis: 1234, name: "packages", status: "failed" }),
      makeRow({ name: "apps", status: "skipped" }),
    ]),
  ).toBe("  ✔ oxlint plugin  0.4s\n  ✗ packages  1.2s\n  ○ apps  skipped\n");
});

it("gives a running row a spinner and its tail", () => {
  expect(
    render([makeRow({ name: "packages", status: "running", tail: "~/packages/ui$ vp pack" })]),
  ).toBe("  ⠋ packages\n    ~/packages/ui$ vp pack\n");
});

it("truncates a tail that would exceed the terminal width", () => {
  const tail = "x".repeat(80);
  const lines = render([makeRow({ name: "packages", status: "running", tail })], 20).split("\n");

  // One column stays free, so the line cannot wrap and push the frame out of
  // step with the number of lines the renderer thinks it drew.
  expect(lines[1]).toHaveLength(19);
  expect(lines[1]?.endsWith("…")).toBe(true);
});

it("renders nothing when there are no rows", () => {
  expect(render([])).toBe("");
});

const subtask = (task: string, command: string): Renderer.Subtask => ({
  command,
  startedAt: 0,
  task,
});

it("cascades the running tasks beneath their phase", () => {
  expect(
    render([
      makeRow({
        name: "packages",
        status: "running",
        subtasks: [
          subtask("@mze-store/ui#build", "vp pack"),
          subtask("@mze-store/auth#build", "varlock codegen"),
        ],
      }),
    ]),
  ).toBe(
    "  ⠋ packages\n" +
      "      ⠋ @mze-store/ui#build  vp pack\n" +
      "      ⠋ @mze-store/auth#build  varlock codegen\n",
  );
});

it("falls back to the tail when a phase runs no Vite+ tasks", () => {
  // `format and lint` is a bare `vp check`, so no task markers ever arrive.
  expect(
    render([makeRow({ name: "format and lint", status: "running", tail: "checking 305" })]),
  ).toBe("  ⠋ format and lint\n    checking 305\n");
});

it("counts the tasks it cannot fit", () => {
  const many = Array.from({ length: 7 }, (_, index) => subtask(`pkg-${index}#build`, "vp pack"));
  const lines = render([makeRow({ name: "packages", status: "running", subtasks: many })])
    .trimEnd()
    .split("\n");

  expect(lines).toHaveLength(7);
  expect(lines.at(-1)).toBe("      +2 more");
});

it("adds a task when it starts and drops it when it ends", () => {
  const started = Renderer.applyMarkers(
    [],
    [
      "[@mze-store/db#build] ~/packages/db$ vp pack ⊘ cache disabled",
      "[@mze-store/ui#build] ~/packages/ui$ vp pack ⊘ cache disabled",
      "ℹ Build start",
    ],
    1000,
  );

  expect(started.map(({ task }) => task)).toEqual(["@mze-store/db#build", "@mze-store/ui#build"]);

  expect(
    Renderer.applyMarkers(started, ["── [@mze-store/db#build] ──"], 2000).map(({ task }) => task),
  ).toEqual(["@mze-store/ui#build"]);
});

it("replaces a task that announces itself twice", () => {
  // Vite+ splits `varlock codegen && vp pack` into two runs under one name.
  const after = Renderer.applyMarkers(
    [],
    [
      "[@mze-store/auth#build] ~/packages/auth$ varlock codegen ⊘ cache disabled",
      "── [@mze-store/auth#build] ──",
      "[@mze-store/auth#build] ~/packages/auth$ vp pack ⊘ cache disabled",
    ],
    1000,
  );

  expect(after).toEqual([{ command: "vp pack", startedAt: 1000, task: "@mze-store/auth#build" }]);
});

it("formats elapsed time in seconds, then in minutes", () => {
  expect(Renderer.elapsed(400)).toBe("0.4s");
  expect(Renderer.elapsed(59_900)).toBe("59.9s");
  expect(Renderer.elapsed(64_000)).toBe("1m 04s");
});

it("takes the last non-blank line and drops ANSI codes", () => {
  expect(Renderer.lastLine("[32mbuilding[39m\n\n")).toBe("building");
  expect(Renderer.lastLine("first\nsecond\n")).toBe("second");
  expect(Renderer.lastLine("\n  \n")).toBeUndefined();
});

it.effect("writes one line per transition when the stream is not a terminal", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const renderer = yield* Renderer.Service;
    yield* renderer.begin(["packages", "apps"]);
    yield* renderer.transition("packages", "running");
    yield* renderer.transition("packages", "succeeded");
    yield* renderer.end();

    expect(capture.stderr.join("")).toBe("  → packages\n  ✔ packages  0.0s\n  ○ apps  skipped\n");
    expect(capture.stdout).toEqual([]);
  }).pipe(
    Effect.provide(Renderer.layer("plain", { color: false })),
    Effect.provide(TerminalCapabilities.fixed({ isTerminal: false })),
    Effect.provide(capture.layer),
  );
});

it.effect("keeps the whole failed phase output for the failure block", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const renderer = yield* Renderer.Service;
    yield* renderer.begin(["packages"]);
    yield* renderer.transition("packages", "running");
    yield* renderer.childOutput("first error\n", "stdout");
    yield* renderer.childOutput("later noise\n", "stdout");
    yield* renderer.transition("packages", "failed");

    // The head of the log is the part that names the cause, so it must survive.
    expect(yield* renderer.failureOutput).toBe("first error\nlater noise\n");
  }).pipe(
    Effect.provide(Renderer.layer("plain", { color: false })),
    Effect.provide(TerminalCapabilities.fixed({ isTerminal: false })),
    Effect.provide(capture.layer),
  );
});

it.effect("passes child output through and rules off each phase when verbose", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const renderer = yield* Renderer.Service;
    yield* renderer.begin(["packages"]);
    yield* renderer.transition("packages", "running");
    yield* renderer.childOutput("compiling\n", "stdout");

    expect(capture.stderr.join("")).toContain("── packages ──");
    expect(capture.stderr.join("")).toContain("compiling\n");
  }).pipe(
    Effect.provide(Renderer.layer("verbose", { color: false })),
    Effect.provide(TerminalCapabilities.fixed({ isTerminal: false, columns: 20 })),
    Effect.provide(capture.layer),
  );
});

it.effect("animates on a terminal, then restores the cursor when the scope closes", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const renderer = yield* Renderer.Service;
      yield* renderer.begin(["packages"]);
      yield* renderer.transition("packages", "running");
      yield* TestClock.adjust("240 millis");

      const written = capture.stderr.join("");
      expect(written).toContain(ansiEscapes.cursorHide);
      expect(written).toContain("⠙");
      expect(written).toContain(ansiEscapes.eraseDown);
      expect(written).not.toContain(ansiEscapes.cursorShow);
    }).pipe(
      Effect.provide(Renderer.layer("live", { color: false })),
      Effect.provide(TerminalCapabilities.fixed({ isTerminal: true, columns: 40 })),
      Effect.provide(capture.layer),
    );

    // The finalizer is the only thing standing between an interrupt and a
    // terminal left without a cursor.
    expect(capture.stderr.join("")).toContain(ansiEscapes.cursorShow);
  }).pipe(Effect.provide(TestClock.layer()));
});
