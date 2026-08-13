import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Ref } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Tasks } from "./tasks.ts";

it.effect("builds workspace declarations before type-aware lint", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);
    const commands = ChildCommand.Service.of({
      capture: () => Effect.die("capture was not expected"),
      run: (spec) => Ref.update(calls, (current) => [...current, spec]),
    });

    yield* Tasks.lint("/repo").pipe(Effect.provideService(ChildCommand.Service, commands));

    expect(yield* Ref.get(calls)).toEqual([
      {
        executable: "vp",
        arguments: ["run", "--filter", "@mze-store/oxlint", "build"],
        cwd: "/repo",
      },
      {
        executable: "vp",
        arguments: ["run", "--filter", "./packages/*", "build"],
        cwd: "/repo",
      },
      { executable: "vp", arguments: ["lint"], cwd: "/repo" },
    ]);
  }),
);

it.effect("passes the worktree service environment to Medusa tests", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);
    const commands = ChildCommand.Service.of({
      capture: (spec) =>
        Ref.update(calls, (current) => [...current, spec]).pipe(
          Effect.as({
            exitCode: 0,
            stderr: "",
            stdout: spec.arguments.includes("postgres") ? "127.0.0.1:41001\n" : "127.0.0.1:41002\n",
          }),
        ),
      run: (spec) => Ref.update(calls, (current) => [...current, spec]),
    });

    yield* Tasks.test("/repo", "workspace").pipe(
      Effect.provideService(ChildCommand.Service, commands),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} })),
    );

    const recorded = yield* Ref.get(calls);
    const workspace = recorded.find(
      (spec) =>
        spec.executable === "vp" && spec.arguments.length === 1 && spec.arguments[0] === "test",
    );
    const medusa = recorded.find(
      (spec) => spec.executable === "vp" && spec.arguments.includes("medusa"),
    );
    expect(workspace?.environment).toEqual(medusa?.environment);
    expect(medusa?.environment).toMatchObject({
      DATABASE_URL: "postgresql://postgres:password@127.0.0.1:41001/mze-store?sslmode=disable",
      DB_HOST: "localhost",
      DB_PORT: "41001",
      REDIS_URL: "redis://127.0.0.1:41002",
    });
  }),
);
