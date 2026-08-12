import { expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem, Path, Ref } from "effect";

import { ChildCommand } from "./child-command.ts";
import { Doctor } from "./doctor.ts";
import { Output } from "./output.ts";

const runDoctor = (options: {
  readonly interrupt?: boolean;
  readonly redisHealth: "healthy" | "starting";
  readonly route?: string;
}) =>
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

      const written = yield* Ref.make<Array<Output.Event>>([]);
      const childCommands = ChildCommand.Service.of({
        capture: (spec) =>
          options.interrupt && spec.executable === "bun"
            ? Effect.interrupt
            : Effect.succeed({
                exitCode: 0,
                stderr: "",
                stdout:
                  spec.executable === "bun"
                    ? "1.3.14\n"
                    : spec.executable === "portless" && spec.arguments[0] === "--version"
                      ? "portless 0.15.5\n"
                      : spec.executable === "portless" && spec.arguments[0] === "list"
                        ? (options.route ?? "No active routes.\n")
                        : spec.arguments.includes("ps")
                          ? JSON.stringify([
                              { Health: "healthy", Service: "postgres" },
                              { Health: options.redisHealth, Service: "redis" },
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

      return { error, written: yield* Ref.get(written) };
    }),
  );

it.effect("rejects services that are not healthy", () =>
  Effect.gen(function* () {
    const { error } = yield* runDoctor({ redisHealth: "starting" });

    expect(error._tag).toBe("DoctorFailed");
    if (error._tag === "DoctorFailed") {
      expect(error.failures).toEqual(["services"]);
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("reports the owner of the shared Medusa route", () =>
  Effect.gen(function* () {
    const { error, written } = yield* runDoctor({
      redisHealth: "healthy",
      route: "https://medusa.mze-store.localhost -> localhost:4321 (pid 1234)\n",
    });

    if (error._tag === "DoctorFailed") {
      expect(error.failures).toEqual(["Medusa route ownership"]);
    }
    expect(written).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          detail: expect.stringContaining("(pid 1234)"),
          message: expect.stringContaining("(pid 1234)"),
        }),
        event: "message",
        stream: "stderr",
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("preserves interruption while running checks", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(runDoctor({ interrupt: true, redisHealth: "healthy" }));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);
