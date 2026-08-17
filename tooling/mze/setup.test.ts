import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Stdio } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Setup } from "./setup.ts";

// The CI branch returns before setup runs anything, so reaching this layer is
// itself the failure the test would be hiding.
const noCommands = ChildCommand.Service.of({
  capture: () => Effect.die("capture was not expected"),
  run: () => Effect.die("run was not expected"),
});

it.effect("keeps JSON setup mode read-only", () =>
  Setup.requireWritableMode("json").pipe(
    Effect.flip,
    Effect.map((error) => {
      expect(error._tag).toBe("SetupRequiresInteractiveTerminal");
      expect(error.exitCode).toBe(1);
    }),
  ),
);

it.effect("rejects setup in CI even when stdin is a terminal", () =>
  Setup.run({ cwd: "/repo", mode: "human", nodeVersion: "24.18.1" }).pipe(
    Effect.provideService(ChildCommand.Service, noCommands),
    Effect.provide(Stdio.layerTest({ stdinIsTerminal: Effect.succeed(true) })),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv({ env: { CI: "1" } }),
    ),
    Effect.flip,
    Effect.map((error) => {
      expect(error._tag).toBe("SetupRequiresInteractiveTerminal");
      expect(error.exitCode).toBe(1);
    }),
  ),
);
