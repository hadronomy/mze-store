import { Effect, FileSystem, Path, Schema, Stdio } from "effect";
import { Prompt } from "effect/unstable/cli";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";
import { Portless } from "./portless.ts";

const NODE_VERSION = "24.18.1";
const BUN_VERSION = "1.3.14";

export class SetupRequiresInteractiveTerminal extends Schema.TaggedError<SetupRequiresInteractiveTerminal>()(
  "SetupRequiresInteractiveTerminal",
  {
    exitCode: Schema.Number,
  },
) {}

export class ToolVersionMismatch extends Schema.TaggedError<ToolVersionMismatch>()(
  "ToolVersionMismatch",
  {
    exitCode: Schema.Number,
    found: Schema.String,
    required: Schema.String,
    tool: Schema.String,
  },
) {}

const assertVersion = (tool: string, found: string, required: string) =>
  found === required
    ? Effect.void
    : Effect.fail(new ToolVersionMismatch({ exitCode: 1, found, required, tool }));

const verifyTools = (nodeVersion: string) =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;

    yield* assertVersion("Node", nodeVersion, NODE_VERSION);
    const bun = yield* commands.capture({ executable: "bun", arguments: ["--version"] });
    yield* assertVersion("Bun", bun.stdout.trim(), BUN_VERSION);
    yield* commands.capture({ executable: "docker", arguments: ["--version"] });
    yield* Portless.checkVersion;
  });

export const requireWritableMode = (mode: Output.Mode) =>
  mode === "json"
    ? Effect.fail(new SetupRequiresInteractiveTerminal({ exitCode: 1 }))
    : Effect.void;

export const run = (options: {
  readonly cwd: string;
  readonly mode: Output.Mode;
  readonly nodeVersion: string;
}) =>
  Effect.gen(function* () {
    yield* requireWritableMode(options.mode);

    const stdio = yield* Stdio.Stdio;
    if (!(yield* stdio.stdinIsTerminal)) {
      return yield* new SetupRequiresInteractiveTerminal({ exitCode: 1 });
    }

    const commands = yield* ChildCommand.Service;
    const fs = yield* FileSystem.FileSystem;
    const output = yield* Output.Service;
    const path = yield* Path.Path;

    yield* verifyTools(options.nodeVersion);

    for (const app of ["storefront", "medusa"] as const) {
      const destination = path.join(options.cwd, "apps", app, ".env");
      if (yield* fs.exists(destination)) {
        continue;
      }

      const source = path.join(options.cwd, "apps", app, ".env.template");
      const confirmed = yield* Prompt.run(
        Prompt.confirm({ message: `Create apps/${app}/.env from its template?` }),
      );
      if (confirmed) {
        yield* fs.copy(source, destination, { overwrite: false });
        yield* output.write({
          command: "setup",
          data: { message: `Created apps/${app}/.env.` },
          event: "message",
          stream: "stdout",
        });
      }
    }

    yield* commands.run({ executable: "vp", arguments: ["config"], cwd: options.cwd });
  });

export * as Setup from "./setup.ts";
