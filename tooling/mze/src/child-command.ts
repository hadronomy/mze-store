import { Context, Effect, Layer, Option, PlatformError, Ref, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { Output } from "./output.ts";

const MAX_CAPTURED_OUTPUT = 16_384;

/**
 * Which phase, if any, is running commands through this service right now.
 *
 * `phase.ts` provides this locally around each node's own effect, so
 * `child-output` events can name the row they belong to without threading a
 * `phase` argument through every `Spec` and every `run` call site — a caller
 * outside any phase reads the default and tags nothing, exactly as before.
 */
export const CurrentPhase = Context.Reference<Option.Option<string>>(
  "@mze-store/tooling/ChildCommand/CurrentPhase",
  { defaultValue: () => Option.none() },
);

export interface Spec {
  readonly executable: string;
  readonly arguments: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface Result {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  command: Schema.String,
  exitCode: Schema.Int,
  stderr: Schema.String,
  stdout: Schema.String,
}) {}

export class ExecutableMissing extends Schema.TaggedError<ExecutableMissing>()(
  "ExecutableMissing",
  {
    command: Schema.String,
    exitCode: Schema.Int,
  },
) {}

export class CommandExecutionFailed extends Schema.TaggedError<CommandExecutionFailed>()(
  "CommandExecutionFailed",
  {
    command: Schema.String,
    description: Schema.String,
    exitCode: Schema.Int,
  },
) {}

export type Error = CommandFailed | ExecutableMissing | CommandExecutionFailed;

export interface Interface {
  readonly capture: (spec: Spec) => Effect.Effect<Result, Error>;
  readonly run: (spec: Spec) => Effect.Effect<void, Error>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@mze-store/tooling/ChildCommand",
) {}

function commandName(spec: Spec): string {
  return [spec.executable, ...spec.arguments].join(" ");
}

function platformError(spec: Spec, error: PlatformError.PlatformError): Error {
  if (error.reason._tag === "NotFound") {
    return new ExecutableMissing({ command: commandName(spec), exitCode: 127 });
  }

  return new CommandExecutionFailed({
    command: commandName(spec),
    description: error.message,
    exitCode: 1,
  });
}

function makeCommand(spec: Spec): ChildProcess.StandardCommand {
  return ChildProcess.make(spec.executable, spec.arguments, {
    cwd: spec.cwd,
    env: spec.environment === undefined ? undefined : { ...spec.environment },
    extendEnv: true,
    forceKillAfter: "5 seconds",
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const output = yield* Output.Service;

    const execute = Effect.fn("ChildCommand.execute")(
      (
        spec: Spec,
        onOutput: (
          stream: Output.OutputStream,
          text: string,
        ) => Effect.Effect<void, PlatformError.PlatformError>,
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner
              .spawn(makeCommand(spec))
              .pipe(Effect.mapError((error) => platformError(spec, error)));
            const stderrTail = yield* Ref.make("");
            const stdoutTail = yield* Ref.make("");

            const drain = (
              stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
              outputStream: Output.OutputStream,
              tail: Ref.Ref<string>,
            ) =>
              stream.pipe(
                Stream.decodeText(),
                Stream.runForEach((text) =>
                  Effect.all(
                    [
                      Ref.update(tail, (current) =>
                        `${current}${text}`.slice(-MAX_CAPTURED_OUTPUT),
                      ),
                      onOutput(outputStream, text),
                    ],
                    { discard: true },
                  ),
                ),
              );

            const [exitCode] = yield* Effect.all(
              [
                handle.exitCode,
                drain(handle.stderr, "stderr", stderrTail),
                drain(handle.stdout, "stdout", stdoutTail),
              ],
              { concurrency: "unbounded" },
            ).pipe(Effect.mapError((error) => platformError(spec, error)));
            const result: Result = {
              exitCode: Number(exitCode),
              stderr: yield* Ref.get(stderrTail),
              stdout: yield* Ref.get(stdoutTail),
            };

            if (result.exitCode !== 0) {
              return yield* new CommandFailed({
                command: commandName(spec),
                ...result,
              });
            }

            return result;
          }),
        ),
    );

    const run = Effect.fn("ChildCommand.run")((spec: Spec) =>
      Effect.gen(function* () {
        const phase = yield* CurrentPhase;
        yield* execute(spec, (stream, text) =>
          output.write({
            command: spec.executable,
            data: text,
            event: "child-output",
            phase: Option.getOrUndefined(phase),
            stream,
          }),
        );
      }),
    );

    const capture = Effect.fn("ChildCommand.capture")((spec: Spec) =>
      execute(spec, () => Effect.void),
    );

    return Service.of({ capture, run });
  }),
);

export * as ChildCommand from "./child-command.ts";
