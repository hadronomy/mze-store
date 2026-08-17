import { Effect, Runtime, Schema } from "effect";

import { ChildCommand } from "./child-command.ts";
import { DataLossConfirmationRequired } from "./database.ts";
import { DevelopmentProcessExited, UnsupportedPlatform } from "./dev.ts";
import { DoctorFailed } from "./doctor.ts";
import { Output } from "./output.ts";
import { PortlessRouteConflict, PortlessUnavailable, PortlessVersionMismatch } from "./portless.ts";
import { ServicesStartFailed, ServicePortInvalid } from "./services.ts";
import { SetupRequiresInteractiveTerminal, ToolVersionMismatch } from "./setup.ts";

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

const OperationalCauseSchema = Schema.Union([
  ChildCommand.CommandFailed,
  ChildCommand.CommandExecutionFailed,
  ChildCommand.ExecutableMissing,
  DataLossConfirmationRequired,
  DevelopmentProcessExited,
  DoctorFailed,
  PortlessRouteConflict,
  PortlessUnavailable,
  PortlessVersionMismatch,
  ServicePortInvalid,
  ServicesStartFailed,
  SetupRequiresInteractiveTerminal,
  ToolVersionMismatch,
  UnsupportedPlatform,
]);

const operationalCause = (cause: unknown) =>
  Schema.is(OperationalCauseSchema)(cause) ? cause : undefined;

export const exitCode = (cause: unknown): number => {
  if (cause instanceof ReportedError) return cause.exitCode;
  return operationalCause(cause)?.exitCode ?? 1;
};

export const message = (cause: unknown): string => {
  const error = operationalCause(cause);

  if (error === undefined) {
    return cause instanceof Error ? cause.message : String(cause);
  }

  switch (error._tag) {
    case "CommandFailed":
      return `Command failed with exit code ${error.exitCode}: ${error.command}`;
    case "CommandExecutionFailed":
      return `Could not run ${error.command}: ${error.description}`;
    case "ExecutableMissing":
      return `Required executable not found: ${error.command}`;
    case "PortlessUnavailable":
      return `Portless ${error.detail} is unavailable. Install it with: ${error.installCommand}`;
    case "PortlessVersionMismatch":
      return `Portless ${error.required} is required; found ${error.found}. Install it with: ${error.installCommand}`;
    case "PortlessRouteConflict":
    case "ServicesStartFailed":
      return error.message;
    case "ServicePortInvalid":
      return `Docker returned an invalid port for ${error.service}.`;
    case "UnsupportedPlatform":
      return `The mze tooling supports macOS and Linux. Found ${error.platform}.`;
    case "DevelopmentProcessExited":
      return `${error.process} exited unexpectedly.`;
    case "SetupRequiresInteractiveTerminal":
      return "Setup requires an interactive terminal. JSON mode is read-only.";
    case "ToolVersionMismatch":
      return `${error.tool} ${error.required} is required; found ${error.found}.`;
    case "DoctorFailed":
      return `Doctor found blocking problems: ${error.failures.join(", ") || "unknown checks"}.`;
    case "DataLossConfirmationRequired":
      return `The ${error.operation} operation requires ${error.flag}.`;
    default: {
      // Add a member to OperationalCauseSchema without a case above and this
      // assignment stops compiling, so the union and this switch cannot drift.
      const unhandled: never = error;
      return String(unhandled);
    }
  }
};

export const report = (command: string, cause: unknown, codeOverride?: number) =>
  Effect.gen(function* () {
    const output = yield* Output.Service;
    const code = codeOverride ?? exitCode(cause);
    yield* output.write({
      command,
      data: { exitCode: code, message: message(cause) },
      event: "failed",
      stream: command === "doctor" && Schema.is(DoctorFailed)(cause) ? "stdout" : "stderr",
    });
    return yield* Effect.fail(new ReportedError(code));
  });

export * as Reporter from "./reporter.ts";
