import { Effect } from "effect";

import { ChildCommand } from "./child-command.ts";

const run = (cwd: string, arguments_: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    yield* commands.run({ executable: "docker", arguments: ["compose", ...arguments_], cwd });
  });

export const build = (cwd: string) => run(cwd, ["build"]);

export const down = (cwd: string, deleteVolumes: boolean) =>
  run(cwd, ["down", ...(deleteVolumes ? ["--volumes"] : [])]);

export const logs = (cwd: string) => run(cwd, ["logs", "-f"]);

export const up = (cwd: string) => run(cwd, ["up", "-d", "--build"]);

export * as Docker from "./docker.ts";
