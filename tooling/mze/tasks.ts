import { Effect } from "effect";

import { ChildCommand } from "./child-command.ts";
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

const runVp = (cwd: string, arguments_: ReadonlyArray<string>) => run(cwd, "vp", arguments_);

export const build = (cwd: string) =>
  Effect.gen(function* () {
    yield* runVp(cwd, ["run", "--filter", "@mze-store/oxlint", "build"]);
    yield* runVp(cwd, ["run", "--filter", "./packages/*", "build"]);
    yield* runVp(cwd, ["run", "--filter", "./apps/*", "build"]);
  });

export const check = (cwd: string) =>
  Effect.gen(function* () {
    yield* runVp(cwd, ["run", "--filter", "@mze-store/oxlint", "check-types"]);
    yield* runVp(cwd, ["run", "--filter", "./packages/*", "build"]);
    yield* runVp(cwd, ["check"]);
    yield* runVp(cwd, ["run", "--filter", "./packages/*", "check-types"]);
    yield* runVp(cwd, ["run", "--filter", "./apps/*", "check-types"]);
  });

export const test = (cwd: string, target: "e2e" | "workspace") =>
  target === "e2e"
    ? run(cwd, "playwright", ["test", "--config=e2e/playwright.config.ts"])
    : Effect.gen(function* () {
        yield* runVp(cwd, ["run", "--filter", "@mze-store/oxlint", "build"]);
        const environment = yield* Services.start(cwd);
        yield* run(cwd, "vp", ["test"], environment);
        yield* run(cwd, "vp", ["run", "--filter", "medusa", "test"], environment);
      });

export const lint = (cwd: string) =>
  Effect.gen(function* () {
    yield* runVp(cwd, ["run", "--filter", "@mze-store/oxlint", "build"]);
    yield* runVp(cwd, ["run", "--filter", "./packages/*", "build"]);
    yield* runVp(cwd, ["lint"]);
  });

export const format = (cwd: string) => runVp(cwd, ["fmt"]);

export * as Tasks from "./tasks.ts";
