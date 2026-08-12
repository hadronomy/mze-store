import { Effect, Runtime } from "effect";

import { Output } from "./output.ts";

export class ReportedError extends Error {
  readonly _tag = "ReportedError";
  readonly exitCode: number;
  readonly [Runtime.errorExitCode]: number;
  readonly [Runtime.errorReported] = false;

  constructor(exitCode: number) {
    super(`Command failed with exit code ${exitCode}.`);
    this.exitCode = exitCode;
    this[Runtime.errorExitCode] = exitCode;
  }
}

const field = (error: unknown, name: string): unknown =>
  typeof error === "object" && error !== null && name in error
    ? Reflect.get(error, name)
    : undefined;

const stringValues = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const exitCode = (error: unknown): number => {
  const code = field(error, "exitCode");
  return typeof code === "number" ? code : 1;
};

export const message = (error: unknown): string => {
  const tag = field(error, "_tag");

  switch (tag) {
    case "CommandFailed":
      return `Command failed with exit code ${String(field(error, "exitCode"))}: ${String(field(error, "command"))}`;
    case "CommandExecutionFailed":
      return `Could not run ${String(field(error, "command"))}: ${String(field(error, "description"))}`;
    case "ExecutableMissing":
      return `Required executable not found: ${String(field(error, "command"))}`;
    case "PortlessUnavailable":
      return `Portless ${String(field(error, "detail"))} is unavailable. Install it with: ${String(field(error, "installCommand"))}`;
    case "PortlessVersionMismatch":
      return `Portless ${String(field(error, "required"))} is required; found ${String(field(error, "found"))}. Install it with: ${String(field(error, "installCommand"))}`;
    case "PortlessRouteConflict":
    case "ServicesStartFailed":
      return String(field(error, "message"));
    case "ServicePortInvalid":
      return `Docker returned an invalid port for ${String(field(error, "service"))}.`;
    case "UnsupportedPlatform":
      return `The mze tooling supports macOS and Linux. Found ${String(field(error, "platform"))}.`;
    case "DevelopmentProcessExited":
      return `${String(field(error, "process"))} exited unexpectedly.`;
    case "SetupRequiresInteractiveTerminal":
      return "Setup requires an interactive terminal. JSON mode is read-only.";
    case "ToolVersionMismatch":
      return `${String(field(error, "tool"))} ${String(field(error, "required"))} is required; found ${String(field(error, "found"))}.`;
    case "DoctorFailed":
      return `Doctor found blocking problems: ${stringValues(field(error, "failures")).join(", ") || "unknown checks"}.`;
    case "DataLossConfirmationRequired":
      return `The ${String(field(error, "operation"))} operation requires ${String(field(error, "flag"))}.`;
    default: {
      const errorMessage = field(error, "message");
      return typeof errorMessage === "string" ? errorMessage : String(error);
    }
  }
};

export const report = (command: string, error: unknown, codeOverride?: number) =>
  Effect.gen(function* () {
    const output = yield* Output.Service;
    const code = codeOverride ?? exitCode(error);
    yield* output.write({
      command,
      data: { exitCode: code, message: message(error) },
      event: "failed",
      stream: "stderr",
    });
    return yield* Effect.fail(new ReportedError(code));
  });

export * as Reporter from "./reporter.ts";
