import { Config, Effect, Schema, Stdio } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";

const NODE_VERSION = "24.18.1";
const BUN_VERSION = "1.3.14";

export class SetupRequiresInteractiveTerminal extends Schema.TaggedError<SetupRequiresInteractiveTerminal>()(
  "SetupRequiresInteractiveTerminal",
  {
    exitCode: Schema.Int,
  },
) {}

export class ToolVersionMismatch extends Schema.TaggedError<ToolVersionMismatch>()(
  "ToolVersionMismatch",
  {
    exitCode: Schema.Int,
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

    // See services.ts: the default covers an absent variable, and a CI value
    // that is not a boolean is a broken environment, not an operator error.
    if (yield* Config.boolean("CI").pipe(Config.withDefault(false), Effect.orDie)) {
      return yield* new SetupRequiresInteractiveTerminal({ exitCode: 1 });
    }

    const stdio = yield* Stdio.Stdio;
    if (!(yield* stdio.stdinIsTerminal)) {
      return yield* new SetupRequiresInteractiveTerminal({ exitCode: 1 });
    }

    const commands = yield* ChildCommand.Service;

    yield* verifyTools(options.nodeVersion);

    // No `.env` files to seed. Each `.env.schema` is committed and carries its
    // own development defaults, so a clean checkout runs without one. The only
    // value with no workable default is STRIPE_API_KEY, and varlock names it,
    // and the file to put it in, the first time something needs it.
    yield* commands.run({ executable: "vp", arguments: ["config"], cwd: options.cwd });
  });

export * as Setup from "./setup.ts";
