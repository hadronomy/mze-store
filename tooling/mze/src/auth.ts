import { Effect } from "effect";

import { ChildCommand } from "./child-command.ts";

export const schema = (cwd: string) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;

    yield* commands.run({
      executable: "vp",
      arguments: ["run", "--filter", "@mze-store/db", "build"],
      cwd,
    });
    yield* commands.run({
      executable: "vp",
      arguments: ["run", "--filter", "@mze-store/auth", "auth:schema"],
      cwd,
    });
    yield* commands.run({
      executable: "vp",
      arguments: ["fmt", "--write", "packages/db/src/schema/auth.ts"],
      cwd,
    });
  });

export * as Auth from "./auth.ts";
