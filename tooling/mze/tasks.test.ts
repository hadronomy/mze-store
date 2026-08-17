import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Ref, Sink, Stdio, Stream } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";
import { Tasks } from "./tasks.ts";

const vp = (cwd: string, arguments_: ReadonlyArray<string>) => ({
  executable: "vp",
  arguments: arguments_,
  cwd,
});

it("builds workspace declarations before type-aware lint", () => {
  expect(Tasks.lint("/repo")).toEqual([
    {
      name: "oxlint plugin",
      spec: vp("/repo", ["run", "--log", "grouped", "--filter", "@mze-store/oxlint", "build"]),
    },
    {
      name: "packages",
      spec: vp("/repo", ["run", "--log", "grouped", "--filter", "./packages/*", "build"]),
    },
    { name: "lint", spec: vp("/repo", ["lint"]) },
  ]);
});

it("buffers every Vite+ task run so a failure log reads in order", () => {
  const runs = [...Tasks.build("/repo"), ...Tasks.check("/repo")]
    .map(({ spec }) => spec.arguments)
    .filter((arguments_) => arguments_[0] === "run");

  expect(runs.length).toBeGreaterThan(0);

  for (const arguments_ of runs) {
    expect(arguments_.slice(0, 3)).toEqual(["run", "--log", "grouped"]);
  }
});

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

it.effect("stops at the first failed phase and never starts the rest", () => {
  const capture = captureStdio();
  const commands = ChildCommand.Service.of({
    capture: () => Effect.die("capture was not expected"),
    run: (spec) =>
      spec.arguments.includes("./packages/*")
        ? Effect.fail(
            new ChildCommand.CommandFailed({
              command: "vp run",
              exitCode: 1,
              stderr: "",
              stdout: "",
            }),
          )
        : Effect.void,
  });

  return Effect.gen(function* () {
    yield* Tasks.runPhases("build", Tasks.build("/repo")).pipe(Effect.ignore);

    const events = [...capture.stdout, ...capture.stderr]
      .flatMap((line) => line.trim().split("\n"))
      .map((line) => JSON.parse(line) as { event: string; data: { phase?: string } });
    const started = events
      .filter(({ event }) => event === "phase-started")
      .map(({ data }) => data.phase);

    expect(started).toEqual(["oxlint plugin", "packages"]);
    expect(events.filter(({ event }) => event === "phase-failed").map(({ data }) => data.phase)) //
      .toEqual(["packages"]);
    expect(events.find(({ event }) => event === "phase-plan")?.data).toEqual({
      phases: ["oxlint plugin", "packages", "apps"],
    });
  }).pipe(
    Effect.provideService(ChildCommand.Service, commands),
    Effect.provide(Output.layer("json")),
    Effect.provide(capture.layer),
  );
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
