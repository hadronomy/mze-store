import { expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path, Schedule } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Output } from "./output.ts";

const layer = Layer.succeed(Output.Service, Output.Service.of({ write: () => Effect.void }));

const provideLive = <A, E>(
  effect: Effect.Effect<A, E, ChildCommand.Service | FileSystem.FileSystem | Path.Path>,
) =>
  effect.pipe(
    Effect.provide(ChildCommand.layer),
    Effect.provide(layer),
    Effect.provide(NodeServices.layer),
  );

const events = (output: string): ReadonlyArray<Record<string, unknown>> =>
  output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

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
      expect(events(error.stdout)).toContainEqual(
        expect.objectContaining({
          command: "mze",
          data: { message: expect.stringContaining("mze <subcommand> [flags]") },
          event: "message",
          stream: "stdout",
          version: 1,
        }),
      );
      expect(events(error.stderr)).toEqual([
        expect.objectContaining({
          command: "mze",
          data: { exitCode: 2, message: expect.stringContaining("Unknown subcommand") },
          event: "failed",
          stream: "stderr",
          version: 1,
        }),
      ]);
    }
  }).pipe(provideLive),
);

it.live("renders JSON help and version output as NDJSON", () =>
  Effect.gen(function* () {
    const commands = yield* ChildCommand.Service;
    const help = yield* commands.capture({
      executable: process.execPath,
      arguments: ["tooling/mze/main.ts", "--json", "--help"],
      cwd: process.cwd(),
    });
    const version = yield* commands.capture({
      executable: process.execPath,
      arguments: ["tooling/mze/main.ts", "--json", "--version"],
      cwd: process.cwd(),
    });

    expect(events(help.stdout)[0]).toMatchObject({
      command: "mze",
      data: { message: expect.stringContaining("mze <subcommand> [flags]") },
      event: "message",
      stream: "stdout",
      version: 1,
    });
    expect(events(version.stdout)[0]).toMatchObject({
      command: "mze",
      data: { message: "mze v1.0.0" },
      event: "message",
      stream: "stdout",
      version: 1,
    });
  }).pipe(provideLive),
);

it.live(
  "maps CLI signals to shell exit codes and cleans up descendants",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const commands = yield* ChildCommand.Service;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "mze-cli-signal-test-" });
        const docker = path.join(directory, "docker");
        yield* fs.writeFileString(
          docker,
          [
            "#!/bin/sh",
            `"${process.execPath}" -e 'setInterval(() => {}, 1000)' &`,
            "grandchild_pid=$!",
            'printf "%s" "$grandchild_pid" > "$MZE_PID_FILE"',
            "trap 'printf SIGTERM > \"$MZE_SIGNAL_FILE\"; exit 0' TERM INT",
            'parent_pid="$(ps -o ppid= -p $$ | tr -d " ")"',
            '(sleep 0.2; kill "-$MZE_TEST_SIGNAL" "$parent_pid") &',
            "while :; do sleep 1; done",
          ].join("\n"),
        );
        yield* fs.chmod(docker, 0o755);
        const waitUntil = (effect: Effect.Effect<boolean, unknown>) =>
          effect.pipe(
            Effect.flatMap((ready) => (ready ? Effect.void : Effect.fail("not ready"))),
            Effect.retry({ schedule: Schedule.spaced("20 millis"), times: 750 }),
          );

        for (const [signal, exitCode] of [
          ["INT", 130],
          ["TERM", 143],
        ] as const) {
          const pidFile = path.join(directory, `${signal}.pid`);
          const signalFile = path.join(directory, `${signal}.txt`);
          const error = yield* commands
            .capture({
              executable: process.execPath,
              arguments: ["tooling/mze/main.ts", "services", "status"],
              cwd: process.cwd(),
              environment: {
                MZE_PID_FILE: pidFile,
                MZE_SIGNAL_FILE: signalFile,
                MZE_TEST_SIGNAL: signal,
                PATH: `${directory}:${process.env.PATH ?? ""}`,
              },
            })
            .pipe(Effect.flip);

          expect(error.exitCode).toBe(exitCode);
          yield* waitUntil(fs.exists(signalFile));
          const grandchildPid = Number((yield* fs.readFileString(pidFile)).trim());
          yield* waitUntil(
            Effect.sync(() => {
              try {
                process.kill(grandchildPid, 0);
                return false;
              } catch {
                return true;
              }
            }),
          );
        }
      }),
    ).pipe(provideLive),
  30_000,
);
