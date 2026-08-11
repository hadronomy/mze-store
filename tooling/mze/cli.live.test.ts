import { expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";

const layer = Layer.succeed(Output.Service, Output.Service.of({ write: () => Effect.void }));

const provideLive = <A, E>(effect: Effect.Effect<A, E, ChildCommand.Service>) =>
  effect.pipe(
    Effect.provide(ChildCommand.layer),
    Effect.provide(layer),
    Effect.provide(NodeServices.layer),
  );

it.live("prints root help and exits successfully when no command is given", () =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const result = yield* commands.capture({
      executable: process.execPath,
      arguments: ["tooling/mze/main.ts"],
      cwd: process.cwd(),
    });

    expect(result.stdout).toContain("mze <subcommand> [flags]");
    expect(result.stdout).toContain("services");
  }).pipe(provideLive),
);

it.live("uses exit code 2 when db push lacks its consequence flag", () =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const error = yield* commands
      .capture({
        executable: process.execPath,
        arguments: ["tooling/mze/main.ts", "db", "push"],
        cwd: process.cwd(),
      })
      .pipe(Effect.flip);

    expect(error._tag).toBe("CommandFailed");
    expect(error.exitCode).toBe(2);
    if (error._tag === "CommandFailed") {
      expect(error.stderr).toContain("--accept-data-loss");
    }
  }).pipe(provideLive),
);

it.live("keeps workflow failures in NDJSON mode", () =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const error = yield* commands
      .capture({
        executable: process.execPath,
        arguments: ["tooling/mze/main.ts", "db", "push", "--json"],
        cwd: process.cwd(),
      })
      .pipe(Effect.flip);

    expect(error.exitCode).toBe(2);
    if (error._tag === "CommandFailed") {
      const started = JSON.parse(error.stdout.trim());
      const failed = JSON.parse(error.stderr.trim());
      expect(started).toMatchObject({
        command: "db push",
        event: "started",
        stream: "stdout",
        version: 1,
      });
      expect(failed).toMatchObject({
        command: "db push",
        data: { exitCode: 2 },
        event: "failed",
        stream: "stderr",
        version: 1,
      });
    }
  }).pipe(provideLive),
);

it.live("keeps parser failures in NDJSON mode", () =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const error = yield* commands
      .capture({
        executable: process.execPath,
        arguments: ["tooling/mze/main.ts", "--json", "not-a-command"],
        cwd: process.cwd(),
      })
      .pipe(Effect.flip);

    expect(error.exitCode).toBe(2);
    if (error._tag === "CommandFailed") {
      expect(error.stdout).toBe("");
      const event = JSON.parse(error.stderr.trim());
      expect(event).toMatchObject({
        command: "mze",
        data: { exitCode: 2 },
        event: "failed",
        stream: "stderr",
        version: 1,
      });
    }
  }).pipe(provideLive),
);
