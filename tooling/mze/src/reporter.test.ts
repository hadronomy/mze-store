import { expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";

import { ChildCommand } from "./child-command.ts";
import { DoctorFailed } from "./doctor.ts";
import { Reporter } from "./reporter.ts";
import { Output } from "./output.ts";

it("formats a tagged child-command failure from its schema", () => {
  const error = new ChildCommand.CommandFailed({
    command: "docker compose up",
    exitCode: 17,
    stderr: "database stopped",
    stdout: "",
  });

  expect(Reporter.exitCode(error)).toBe(17);
  expect(Reporter.message(error)).toBe("Command failed with exit code 17: docker compose up");
});

it("formats a tagged doctor failure without record-field probing", () => {
  const error = new DoctorFailed({ exitCode: 1, failures: ["docker", "services"] });

  expect(Reporter.message(error)).toBe("Doctor found blocking problems: docker, services.");
});

it("falls back to ordinary Error messages for defects", () => {
  const error = new Error("unexpected defect");

  expect(Reporter.exitCode(error)).toBe(1);
  expect(Reporter.message(error)).toBe("unexpected defect");
});

it.effect("writes the final doctor result to stdout", () =>
  Effect.gen(function* () {
    const written = yield* Ref.make<Array<Output.Event>>([]);
    const error = new DoctorFailed({ exitCode: 1, failures: ["services"] });

    yield* Reporter.report("doctor", error).pipe(
      Effect.provideService(
        Output.Service,
        Output.Service.of({
          write: (event) => Ref.update(written, (events) => [...events, event]),
        }),
      ),
      Effect.flip,
    );

    expect(yield* Ref.get(written)).toEqual([
      expect.objectContaining({
        command: "doctor",
        event: "failed",
        stream: "stdout",
      }),
    ]);
  }),
);
