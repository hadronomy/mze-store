import { Effect, Schema } from "effect";

import { ChildCommand } from "./child-command.ts";

export class DataLossConfirmationRequired extends Schema.TaggedError<DataLossConfirmationRequired>()(
  "DataLossConfirmationRequired",
  {
    exitCode: Schema.Number,
    flag: Schema.String,
    operation: Schema.String,
  },
) {}

const run = (cwd: string, executable: string, arguments_: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    yield* commands.run({ executable, arguments: arguments_, cwd });
  });

const runVp = (cwd: string, arguments_: ReadonlyArray<string>) => run(cwd, "vp", arguments_);

export const build = (cwd: string) =>
  Effect.gen(function* () {
    yield* runVp(cwd, ["run", "--filter", "./packages/*", "build"]);
    yield* runVp(cwd, ["run", "--filter", "./apps/*", "build"]);
  });

export const check = (cwd: string) =>
  Effect.gen(function* () {
    yield* runVp(cwd, ["check"]);
    yield* runVp(cwd, ["run", "--filter", "./packages/*", "build"]);
    yield* runVp(cwd, ["run", "--filter", "./packages/*", "check-types"]);
    yield* runVp(cwd, ["run", "--filter", "./apps/*", "check-types"]);
  });

export const test = (cwd: string, target: "e2e" | "workspace") =>
  target === "e2e"
    ? run(cwd, "playwright", ["test", "--config=e2e/playwright.config.ts"])
    : Effect.gen(function* () {
        yield* runVp(cwd, ["test"]);
        yield* runVp(cwd, ["run", "--filter", "medusa", "test"]);
      });

export const lint = (cwd: string) => runVp(cwd, ["lint"]);

export const format = (cwd: string) => runVp(cwd, ["fmt"]);

export const database = (
  cwd: string,
  operation: "generate" | "migrate" | "push" | "studio",
  acceptDataLoss: boolean,
) =>
  Effect.gen(function* () {
    if (operation === "push" && !acceptDataLoss) {
      return yield* new DataLossConfirmationRequired({
        exitCode: 2,
        flag: "--accept-data-loss",
        operation: "db push",
      });
    }

    yield* runVp(cwd, ["run", "--filter", "@mze-store/db", `db:${operation}`]);
  });

export const authSchema = (cwd: string) =>
  Effect.gen(function* () {
    yield* runVp(cwd, ["run", "@mze-store/env#build"]);
    yield* runVp(cwd, ["run", "--filter", "@mze-store/db", "build"]);
    yield* runVp(cwd, ["run", "--filter", "@mze-store/auth", "auth:schema"]);
    yield* runVp(cwd, ["fmt", "--write", "packages/db/src/schema/auth.ts"]);
  });

export const docker = (
  cwd: string,
  operation: "build" | "down" | "logs" | "up",
  deleteVolumes: boolean,
) => {
  switch (operation) {
    case "build":
      return run(cwd, "docker", ["compose", "build"]);
    case "down":
      return run(cwd, "docker", ["compose", "down", ...(deleteVolumes ? ["--volumes"] : [])]);
    case "logs":
      return run(cwd, "docker", ["compose", "logs", "-f"]);
    case "up":
      return run(cwd, "docker", ["compose", "up", "-d", "--build"]);
  }
};

export * as Tasks from "./tasks.ts";
