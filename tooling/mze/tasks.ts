import { Effect, Option } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";
import { Renderer } from "./renderer.ts";
import { Services } from "./services.ts";

/**
 * One labelled step of a batch command.
 *
 * The list is declarative so the renderer can show every step before the first
 * process starts, and so the tests can assert a value instead of recording
 * calls through a fake service.
 */
export interface Phase {
  readonly name: string;
  readonly spec: ChildCommand.Spec;
}

const run = (
  cwd: string,
  executable: string,
  arguments_: ReadonlyArray<string>,
  environment?: ChildCommand.Spec["environment"],
) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const spec = {
      executable,
      arguments: arguments_,
      cwd,
    } satisfies ChildCommand.Spec;
    yield* commands.run(environment === undefined ? spec : { ...spec, environment });
  });

const runVp = (cwd: string, arguments_: ReadonlyArray<string>) => run(cwd, "vp", arguments_);

const vp = (cwd: string, arguments_: ReadonlyArray<string>): ChildCommand.Spec => ({
  executable: "vp",
  arguments: arguments_,
  cwd,
});

/**
 * A Vite+ task run, buffered per task.
 *
 * Vite+ interleaves concurrent tasks by default, which produces a failure log
 * braided from several packages. `grouped` prints each task as one block when
 * it finishes, so both the captured failure output and the verbose view read
 * in order.
 */
const vpRun = (cwd: string, arguments_: ReadonlyArray<string>): ChildCommand.Spec =>
  vp(cwd, ["run", "--log", "grouped", ...arguments_]);

export const build = (cwd: string): ReadonlyArray<Phase> => [
  { name: "oxlint plugin", spec: vpRun(cwd, ["--filter", "@mze-store/oxlint", "build"]) },
  { name: "packages", spec: vpRun(cwd, ["--filter", "./packages/*", "build"]) },
  { name: "apps", spec: vpRun(cwd, ["--filter", "./apps/*", "build"]) },
];

export const check = (cwd: string): ReadonlyArray<Phase> => [
  { name: "oxlint plugin", spec: vpRun(cwd, ["--filter", "@mze-store/oxlint", "check-types"]) },
  { name: "packages", spec: vpRun(cwd, ["--filter", "./packages/*", "build"]) },
  { name: "format and lint", spec: vp(cwd, ["check"]) },
  { name: "package types", spec: vpRun(cwd, ["--filter", "./packages/*", "check-types"]) },
  { name: "app types", spec: vpRun(cwd, ["--filter", "./apps/*", "check-types"]) },
  // mze checks itself last, so a change to this file is covered by the command
  // that file defines.
  { name: "tooling types", spec: vpRun(cwd, ["--filter", "@mze-store/mze", "check-types"]) },
];

export const lint = (cwd: string): ReadonlyArray<Phase> => [
  { name: "oxlint plugin", spec: vpRun(cwd, ["--filter", "@mze-store/oxlint", "build"]) },
  { name: "packages", spec: vpRun(cwd, ["--filter", "./packages/*", "build"]) },
  { name: "lint", spec: vp(cwd, ["lint"]) },
];

/**
 * Run a phase list, reporting each step to the event stream and the renderer.
 *
 * Effect stops the loop at the first failure, so the renderer reports whatever
 * never ran as skipped rather than erasing it.
 */
export const runPhases = (command: string, phases: ReadonlyArray<Phase>) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const output = yield* Output.Service;
    const renderer = yield* Effect.serviceOption(Renderer.Service);

    // A closed pipe on the render stream must not take the build down with it.
    const draw = (use: (renderer: Renderer.Interface) => Effect.Effect<void, unknown>) =>
      Option.isSome(renderer) ? use(renderer.value).pipe(Effect.ignore) : Effect.void;

    const event = (
      name: "phase-started" | "phase-succeeded" | "phase-failed",
      phase: string,
      elapsedMillis?: number,
    ) =>
      output.write({
        command,
        data: elapsedMillis === undefined ? { phase } : { elapsedMillis, phase },
        event: name,
        stream: name === "phase-failed" ? "stderr" : "stdout",
      });

    yield* draw((current) => current.begin(phases.map(({ name }) => name)));
    yield* output.write({
      command,
      data: { phases: phases.map(({ name }) => name) },
      event: "phase-plan",
      stream: "stdout",
    });

    yield* Effect.forEach(
      phases,
      (phase) =>
        Effect.gen(function* () {
          const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
          yield* draw((current) => current.transition(phase.name, "running"));
          yield* event("phase-started", phase.name);

          const settle = (status: "succeeded" | "failed") =>
            Effect.gen(function* () {
              const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
              yield* draw((current) => current.transition(phase.name, status));
              yield* event(`phase-${status}`, phase.name, now - startedAt);
            });

          return yield* commands.run(phase.spec).pipe(
            Effect.tap(() => settle("succeeded")),
            Effect.tapError(() => settle("failed")),
          );
        }),
      { discard: true },
    ).pipe(
      Effect.onExit(() =>
        Effect.gen(function* () {
          yield* draw((current) => current.end);
          const captured = Option.isSome(renderer) ? yield* renderer.value.failureOutput : "";

          if (captured === "") {
            return;
          }

          yield* draw((current) => current.write(`\n${captured}`));
        }),
      ),
    );
  });

export const test = (cwd: string, target: "e2e" | "workspace") =>
  target === "e2e"
    ? run(cwd, "playwright", ["test", "--config=e2e/playwright.config.ts"])
    : Effect.gen(function* () {
        yield* runVp(cwd, ["run", "--log", "grouped", "--filter", "@mze-store/oxlint", "build"]);
        const environment = yield* Services.start(cwd);
        yield* run(cwd, "vp", ["test"], environment);
        yield* run(cwd, "vp", ["run", "--filter", "medusa", "test"], environment);
      });

export const format = (cwd: string) => runVp(cwd, ["fmt"]);

export * as Tasks from "./tasks.ts";
