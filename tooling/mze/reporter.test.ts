import { expect, it } from "@effect/vitest";

import { ChildCommand } from "./child-command.ts";
import { DoctorFailed } from "./doctor.ts";
import { Reporter } from "./reporter.ts";

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
