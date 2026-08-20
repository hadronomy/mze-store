import { Effect, Option } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";
import { Phase } from "./phase.ts";
import { PhaseState } from "./phase-state.ts";
import { Renderer } from "./renderer.ts";
import { Services } from "./services.ts";

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

const vp = (cwd: string, arguments_: ReadonlyArray<string>) => run(cwd, "vp", arguments_);

/**
 * A Vite+ task run, buffered per task.
 *
 * Vite+ interleaves concurrent tasks by default, which produces a failure log
 * braided from several packages. `grouped` prints each task as one block when
 * it finishes, so both the captured failure output and the verbose view read
 * in order.
 */
const vpRun = (cwd: string, arguments_: ReadonlyArray<string>) =>
  vp(cwd, ["run", "--log", "grouped", ...arguments_]);

/**
 * `apps` needs `packages` built first: the workspace `types` condition points
 * into `dist/`, so `tsc` reads a dependency's declarations, never its source.
 * `oxlint plugin` has no such reader — nothing in `build` depends on it, it is
 * simply another workspace package this command builds — so it runs alongside
 * `packages` instead of ahead of it.
 */
export const build = (cwd: string): Phase.Graph => {
  const oxlintPlugin = Phase.make(
    "oxlint plugin",
    vpRun(cwd, ["--filter", "@mze-store/oxlint", "build"]),
  );
  const packages = Phase.make("packages", vpRun(cwd, ["--filter", "./packages/*", "build"]));
  const apps = Phase.make("apps", vpRun(cwd, ["--filter", "./apps/*", "build"])).pipe(
    Phase.after(packages),
  );

  return Phase.all(oxlintPlugin, packages, apps);
};

/**
 * `oxlint plugin`'s own `check-types` task depends on its own `build` task
 * (declared in `tooling/oxlint/vite.config.ts`), so Vite+'s graph builds it
 * before `format and lint` needs the built plugin — this command never has to
 * ask for that build directly.
 *
 * `format and lint` reads source through the built plugin, not through any
 * package's `dist/`, so it depends only on `oxlint plugin`. `package types`
 * and `app types` read declarations, so they depend only on `packages`.
 * `tooling types` and `packages` share no dependency with anything else here
 * and run alongside whatever else is ready.
 */
export const check = (cwd: string): Phase.Graph => {
  const oxlintPlugin = Phase.make(
    "oxlint plugin",
    vpRun(cwd, ["--filter", "@mze-store/oxlint", "check-types"]),
  );
  const packages = Phase.make("packages", vpRun(cwd, ["--filter", "./packages/*", "build"]));
  const toolingTypes = Phase.make(
    "tooling types",
    vpRun(cwd, ["--filter", "@mze-store/mze", "check-types"]),
  );
  const formatAndLint = Phase.make("format and lint", vp(cwd, ["check"])).pipe(
    Phase.after(oxlintPlugin),
  );
  const packageTypes = Phase.make(
    "package types",
    vpRun(cwd, ["--filter", "./packages/*", "check-types"]),
  ).pipe(Phase.after(packages));
  const appTypes = Phase.make(
    "app types",
    vpRun(cwd, ["--filter", "./apps/*", "check-types"]),
  ).pipe(Phase.after(packages));

  return Phase.all(oxlintPlugin, packages, toolingTypes, formatAndLint, packageTypes, appTypes);
};

/**
 * `lint` depends on both `oxlint plugin` and `packages` because its type-aware
 * rules need built declarations. `check` has the same dependency for its
 * `format and lint` phase.
 * `oxlint plugin` and `packages` share no dependency, so they still run
 * concurrently; only `lint` itself waits for both.
 */
export const lint = (cwd: string): Phase.Graph => {
  const oxlintPlugin = Phase.make(
    "oxlint plugin",
    vpRun(cwd, ["--filter", "@mze-store/oxlint", "build"]),
  );
  const packages = Phase.make("packages", vpRun(cwd, ["--filter", "./packages/*", "build"]));
  const lint = Phase.make("lint", vp(cwd, ["lint"])).pipe(
    Phase.after(oxlintPlugin),
    Phase.after(packages),
  );

  return Phase.all(oxlintPlugin, packages, lint);
};

/**
 * Runs a graph, reporting each node to the event stream and the renderer.
 *
 * The graph itself stops starting new work at the first failure; whatever
 * never got to run stays `"skipped"` rather than erased. Settling the rows and printing the failed
 * phase's own output is `Renderer`'s job, done automatically as its scope
 * closes — this only has to announce the plan before the graph runs.
 */
export const runPhases = (command: string, graph: Phase.Graph) =>
  Effect.gen(function* () {
    const output = yield* Output.Service;
    const renderer = yield* Effect.serviceOption(Renderer.Service);
    const names = Phase.names(graph);

    // A closed pipe on the render stream must not take the build down with it.
    if (Option.isSome(renderer)) {
      yield* renderer.value.begin(names).pipe(Effect.ignore);
    }

    yield* output.write({
      command,
      data: { phases: names },
      event: "phase-plan",
      stream: "stdout",
    });

    const reporter = yield* PhaseState.reporter(command);
    yield* Phase.run(graph, reporter);
  });

export const test = (cwd: string, target: "e2e" | "workspace") =>
  target === "e2e"
    ? run(cwd, "playwright", ["test", "--config=e2e/playwright.config.ts"])
    : Effect.gen(function* () {
        yield* vpRun(cwd, ["--filter", "@mze-store/oxlint", "build"]);
        const environment = yield* Services.start(cwd);
        yield* run(cwd, "vp", ["test"], environment);
        yield* run(cwd, "vp", ["run", "--filter", "medusa", "test"], environment);
      });

export const format = (cwd: string) => vp(cwd, ["fmt"]);

export * as Tasks from "./tasks.ts";
