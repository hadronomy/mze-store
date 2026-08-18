import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Ref, Sink, Stdio, Stream } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";
import { Phase } from "./phase.ts";
import { Tasks } from "./tasks.ts";

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

function recordingChildCommand(fail: (spec: ChildCommand.Spec) => boolean = () => false) {
  return Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);
    const commands = ChildCommand.Service.of({
      capture: () => Effect.die("capture was not expected"),
      run: (spec) =>
        Ref.update(calls, (current) => [...current, spec]).pipe(
          Effect.andThen(
            fail(spec)
              ? Effect.fail(
                  new ChildCommand.CommandFailed({
                    command: "vp run",
                    exitCode: 1,
                    stderr: "",
                    stdout: "",
                  }),
                )
              : Effect.void,
          ),
        ),
    });
    return { calls, commands };
  });
}

it("names every phase before any of them run", () => {
  expect(Phase.names(Tasks.build("/repo"))).toEqual(["oxlint plugin", "packages", "apps"]);
  expect(Phase.names(Tasks.check("/repo"))).toEqual([
    "oxlint plugin",
    "packages",
    "tooling types",
    "format and lint",
    "package types",
    "app types",
  ]);
  expect(Phase.names(Tasks.lint("/repo"))).toEqual(["oxlint plugin", "packages", "lint"]);
});

it("apps depends only on packages, not on oxlint plugin", () => {
  const apps = Tasks.build("/repo").nodes.find((node) => node.name === "apps");
  expect(apps?.dependencies.map((dependency) => dependency.name)).toEqual(["packages"]);
});

it.effect("buffers every Vite+ task run so a failure log reads in order", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const { calls, commands } = yield* recordingChildCommand();

    yield* Tasks.runPhases("build", Tasks.build("/repo")).pipe(
      Effect.provideService(ChildCommand.Service, commands),
    );

    const runs = (yield* Ref.get(calls))
      .map((spec) => spec.arguments)
      .filter((arguments_) => arguments_[0] === "run");

    expect(runs.length).toBeGreaterThan(0);
    for (const arguments_ of runs) {
      expect(arguments_.slice(0, 3)).toEqual(["run", "--log", "grouped"]);
    }
  }).pipe(Effect.provide(Layer.provide(Output.layer("json"), capture.layer)));
});

it.effect("stops at the first failed phase and never starts the rest", () => {
  const capture = captureStdio();

  return Effect.gen(function* () {
    const { commands } = yield* recordingChildCommand((spec) =>
      spec.arguments.includes("./packages/*"),
    );

    yield* Tasks.runPhases("build", Tasks.build("/repo")).pipe(
      Effect.ignore,
      Effect.provideService(ChildCommand.Service, commands),
    );

    const events = [...capture.stdout, ...capture.stderr]
      .flatMap((line) => line.trim().split("\n"))
      .map((line) => JSON.parse(line) as { event: string; data: { phase?: string } });
    const started = events
      .filter(({ event }) => event === "phase-started")
      .map(({ data }) => data.phase);

    // `oxlint plugin` and `packages` have no dependency on each other, so a
    // real scheduler runs them concurrently — their relative start order is
    // not guaranteed, only that both start and `apps` never does.
    expect(started.toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual([
      "oxlint plugin",
      "packages",
    ]);
    expect(events.filter(({ event }) => event === "phase-failed").map(({ data }) => data.phase)) //
      .toEqual(["packages"]);
    expect(events.filter(({ event }) => event === "phase-skipped").map(({ data }) => data.phase)) //
      .toEqual(["apps"]);
    expect(events.find(({ event }) => event === "phase-plan")?.data).toEqual({
      phases: ["oxlint plugin", "packages", "apps"],
    });
  }).pipe(Effect.provide(Layer.provide(Output.layer("json"), capture.layer)));
});

it.effect("passes the worktree service environment to Medusa tests", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);
    const commands = ChildCommand.Service.of({
      capture: (spec) =>
        Ref.update(calls, (current) => [...current, spec]).pipe(
          Effect.as({
            exitCode: 0,
            stderr: "",
            stdout: spec.arguments.includes("postgres") ? "127.0.0.1:41001\n" : "127.0.0.1:41002\n",
          }),
        ),
      run: (spec) => Ref.update(calls, (current) => [...current, spec]),
    });

    yield* Tasks.test("/repo", "workspace").pipe(
      Effect.provideService(ChildCommand.Service, commands),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} })),
    );

    const recorded = yield* Ref.get(calls);
    const workspace = recorded.find(
      (spec) =>
        spec.executable === "vp" && spec.arguments.length === 1 && spec.arguments[0] === "test",
    );
    const medusa = recorded.find(
      (spec) => spec.executable === "vp" && spec.arguments.includes("medusa"),
    );
    expect(workspace?.environment).toEqual(medusa?.environment);
    expect(medusa?.environment).toMatchObject({
      DB_HOST: "localhost",
      DB_PORT: "41001",
      REDIS_PORT: "41002",
    });
  }),
);
