import { expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path, Ref } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Doctor } from "./doctor.ts";
import { Output } from "./output.ts";

it.effect("rejects services that are not healthy", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "mze-doctor-test-" });
      for (const app of ["storefront", "medusa"]) {
        const directory = path.join(cwd, "apps", app);
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(path.join(directory, ".env"), "TEST=true\n");
      }

      const childCommands = ChildCommand.Service.of({
        capture: (spec) =>
          Effect.succeed({
            exitCode: 0,
            stderr: "",
            stdout:
              spec.executable === "bun"
                ? "1.3.14\n"
                : spec.executable === "portless" && spec.arguments[0] === "--version"
                  ? "portless 0.15.5\n"
                  : spec.arguments.includes("ps")
                    ? JSON.stringify([
                        { Health: "healthy", Service: "postgres" },
                        { Health: "starting", Service: "redis" },
                      ])
                    : "ok\n",
          }),
        run: () => Effect.void,
      });
      const error = yield* Doctor.run({
        cwd,
        nodeVersion: "24.18.1",
        platform: "linux",
      }).pipe(
        Effect.provideService(ChildCommand.Service, childCommands),
        Effect.provideService(Output.Service, Output.Service.of({ write: () => Effect.void })),
        Effect.flip,
      );

      expect(error._tag).toBe("DoctorFailed");
      expect(error.failures).toEqual(["services"]);
    }),
  ).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, Path.layer))),
);

it.effect("reports the owner of the shared Medusa route", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "mze-doctor-route-test-" });
      for (const app of ["storefront", "medusa"]) {
        const directory = path.join(cwd, "apps", app);
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(path.join(directory, ".env"), "TEST=true\n");
      }

      const written = yield* Ref.make<Array<Output.Event>>([]);
      const childCommands = ChildCommand.Service.of({
        capture: (spec) =>
          Effect.succeed({
            exitCode: 0,
            stderr: "",
            stdout:
              spec.executable === "bun"
                ? "1.3.14\n"
                : spec.executable === "portless" && spec.arguments[0] === "--version"
                  ? "portless 0.15.5\n"
                  : spec.executable === "portless" && spec.arguments[0] === "list"
                    ? "https://medusa.mze-store.localhost -> localhost:4321 (pid 1234)\n"
                    : spec.arguments.includes("ps")
                      ? JSON.stringify([
                          { Health: "healthy", Service: "postgres" },
                          { Health: "healthy", Service: "redis" },
                        ])
                      : "ok\n",
          }),
        run: () => Effect.void,
      });
      const error = yield* Doctor.run({
        cwd,
        nodeVersion: "24.18.1",
        platform: "linux",
      }).pipe(
        Effect.provideService(ChildCommand.Service, childCommands),
        Effect.provideService(
          Output.Service,
          Output.Service.of({
            write: (event) => Ref.update(written, (current) => [...current, event]),
          }),
        ),
        Effect.flip,
      );

      expect(error.failures).toEqual(["Medusa route ownership"]);
      expect(yield* Ref.get(written)).toContainEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            message: expect.stringContaining("(pid 1234)"),
          }),
          event: "message",
          stream: "stderr",
        }),
      );
    }),
  ).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, Path.layer))),
);
