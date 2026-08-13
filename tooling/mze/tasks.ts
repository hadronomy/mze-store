import { Effect } from "effect";

import { ChildCommand } from "./child-command.ts";

const run = (cwd: string, executable: string, arguments_: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    yield* commands.run({ executable, arguments: arguments_, cwd });
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
        yield* runVp(cwd, ["test"]);
        yield* runVp(cwd, ["run", "--filter", "medusa", "test"]);
      });

export const lint = (cwd: string) =>
  Effect.gen(function* () {
    yield* runVp(cwd, ["run", "--filter", "@mze-store/oxlint", "build"]);
    yield* runVp(cwd, ["run", "--filter", "./packages/*", "build"]);
    yield* runVp(cwd, ["lint"]);
  });

export const format = (cwd: string) => runVp(cwd, ["fmt"]);

export * as Tasks from "./tasks.ts";
