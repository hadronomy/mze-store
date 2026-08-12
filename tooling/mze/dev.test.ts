import { expect, it } from "@effect/vitest";
import { Effect, Layer, Path, Ref } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Dev } from "./dev.ts";

it.effect("starts a Storefront with discovered service ports", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ChildCommand.Spec>>([]);
    const commands = Layer.succeed(
      ChildCommand.Service,
      ChildCommand.Service.of({
        capture: (spec) =>
          Ref.update(calls, (current) => [...current, spec]).pipe(
            Effect.as({
              exitCode: 0,
              stderr: "",
              stdout:
                spec.executable === "portless"
                  ? "0.15.5\n"
                  : spec.arguments.includes("postgres")
                    ? "127.0.0.1:41001\n"
                    : "127.0.0.1:41002\n",
            }),
          ),
        run: (spec) => Ref.update(calls, (current) => [...current, spec]),
      }),
    );

    yield* Dev.run({ cwd: "/repo", platform: "darwin", target: "storefront" }).pipe(
      Effect.provide(commands),
      Effect.provide(Path.layer),
      Effect.ignore,
    );
    const recorded = yield* Ref.get(calls);
    const storefront = recorded.find(
      (spec) => spec.executable === "portless" && spec.arguments[0] === "run",
    );

    expect(storefront).toEqual({
      executable: "portless",
      arguments: ["run", "--name", "storefront.mze-store", "vp", "dev"],
      cwd: "/repo/apps/storefront",
      environment: {
        DATABASE_URL: "postgresql://postgres:password@127.0.0.1:41001/mze-store",
        REDIS_URL: "redis://127.0.0.1:41002",
      },
    });
    expect(recorded.some((spec) => spec.arguments.includes("medusa.mze-store"))).toBe(false);
  }),
);

it.effect("rejects Windows before it starts a process", () =>
  Dev.run({ cwd: "/repo", platform: "win32", target: "all" }).pipe(
    Effect.provide(
      Layer.succeed(
        ChildCommand.Service,
        ChildCommand.Service.of({
          capture: () => Effect.die("capture was not expected"),
          run: () => Effect.die("run was not expected"),
        }),
      ),
    ),
    Effect.provide(Path.layer),
    Effect.flip,
    Effect.map((error) => {
      expect(error._tag).toBe("UnsupportedPlatform");
      expect(error.exitCode).toBe(1);
    }),
  ),
);
