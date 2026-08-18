import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Ref } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Database } from "./database.ts";

const recordingCommands = (calls: Ref.Ref<Array<ChildCommand.Spec>>) =>
  ChildCommand.Service.of({
    capture: (spec) =>
      Ref.update(calls, (current) => [...current, spec]).pipe(
        Effect.as({
          exitCode: 0,
          stderr: "",
          stdout: spec.arguments.includes("postgres") ? "127.0.0.1:49153\n" : "127.0.0.1:49154\n",
        }),
      ),
    run: (spec) => Ref.update(calls, (current) => [...current, spec]),
  });

it.effect("does not start a database push without the consequence flag", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);
    const error = yield* Database.run("/repo", "push", false).pipe(
      Effect.provideService(ChildCommand.Service, recordingCommands(calls)),
      Effect.flip,
    );

    expect(error).toMatchObject({
      _tag: "DataLossConfirmationRequired",
      exitCode: 2,
      flag: "--accept-data-loss",
    });
    expect(yield* Ref.get(calls)).toEqual([]);
  }),
);

it.effect("maps accepted data loss to a non-interactive database push", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);
    yield* Database.run("/repo", "push", true).pipe(
      Effect.provideService(ChildCommand.Service, recordingCommands(calls)),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} })),
    );

    expect((yield* Ref.get(calls)).at(-1)).toEqual({
      executable: "vp",
      arguments: ["run", "--filter", "@mze-store/db", "db:push", "--force"],
      cwd: "/repo",
      environment: {
        DB_HOST: "localhost",
        DB_PASSWORD: "password",
        DB_PORT: "49153",
        DB_USERNAME: "postgres",
        POSTGRES_PASSWORD: "password",
        REDIS_PORT: "49154",
      },
    });
  }),
);

it.effect("does not force database operations that do not approve data loss", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);
    const commands = recordingCommands(calls);

    for (const operation of ["generate", "migrate", "studio"] as const) {
      yield* Database.run("/repo", operation, false).pipe(
        Effect.provideService(ChildCommand.Service, commands),
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} })),
      );
    }

    const operations = (yield* Ref.get(calls)).filter(
      (spec) => spec.executable === "vp" && spec.arguments.some((value) => value.startsWith("db:")),
    );
    expect(operations).toHaveLength(3);
    expect(operations.every((spec) => !spec.arguments.includes("--force"))).toBe(true);
  }),
);
