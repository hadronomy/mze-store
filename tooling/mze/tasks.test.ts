import { expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";

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
