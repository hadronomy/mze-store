import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Portless } from "./portless.ts";

const commandsLayer = (service: ChildCommand.Interface) =>
  Layer.succeed(ChildCommand.Service, ChildCommand.Service.of(service));

it.effect("accepts the pinned Portless version", () =>
  Portless.checkVersion.pipe(
    Effect.provide(
      commandsLayer({
        capture: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "portless 0.15.5\n" }),
        run: () => Effect.void,
      }),
    ),
    Effect.map((version) => expect(version).toBe(Portless.REQUIRED_VERSION)),
  ),
);

it.effect("rejects a different Portless version with the install command", () =>
  Portless.checkVersion.pipe(
    Effect.provide(
      commandsLayer({
        capture: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "portless 0.15.4\n" }),
        run: () => Effect.void,
      }),
    ),
    Effect.flip,
    Effect.map((error) => {
      expect(error._tag).toBe("PortlessVersionMismatch");
      expect(error.exitCode).toBe(1);
      expect(error.installCommand).toBe("bun add --global portless@0.15.5");
    }),
  ),
);

it.effect("turns the Medusa route conflict into an actionable error", () =>
  Portless.runMedusa({ cwd: "/repo/apps/medusa", environment: {} }).pipe(
    Effect.provide(
      commandsLayer({
        capture: () => Effect.die("capture was not expected"),
        run: () =>
          Effect.fail(
            new ChildCommand.CommandFailed({
              command: "portless medusa.mze-store medusa develop",
              exitCode: 1,
              stderr:
                'Error: "medusa.mze-store.localhost" is already registered by a running process',
              stdout: "",
            }),
          ),
      }),
    ),
    Effect.flip,
    Effect.map((error) => {
      expect(error._tag).toBe("PortlessRouteConflict");
      if (error._tag === "PortlessRouteConflict") {
        expect(error.message).toContain("bun run mze dev storefront");
        expect(error.message).toContain("Do not use `--force`");
      }
    }),
  ),
);
