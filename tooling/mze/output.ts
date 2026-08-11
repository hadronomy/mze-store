import { Chalk, chalkStderr, type ChalkInstance } from "chalk";
import { Clock, Context, Effect, Layer, Stdio, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";

export type Mode = "human" | "json";
export type OutputStream = "stderr" | "stdout";

interface BaseEvent {
  readonly command: string;
  readonly stream: OutputStream;
}

export type Event =
  | (BaseEvent & {
      readonly data: string;
      readonly event: "child-output";
    })
  | (BaseEvent & {
      readonly data: { readonly exitCode: number; readonly message: string };
      readonly event: "failed";
    })
  | (BaseEvent & {
      readonly data: { readonly message: string; readonly [key: string]: unknown };
      readonly event: "message";
    })
  | (BaseEvent & {
      readonly event: "started" | "succeeded";
    });

export interface Interface {
  readonly write: (event: Event) => Effect.Effect<void, PlatformError>;
}

export class Service extends Context.Service<Service, Interface>()("@mze-store/tooling/Output") {}

export interface Options {
  /** Force color in tests. Omit this field to use Chalk's stream detection. */
  readonly color?: boolean;
}

const stripStatusPrefix = (message: string): string => message.replace(/^[✓✗]\s*/, "");

function humanText(event: Event, colors: ChalkInstance): string {
  if (event.event === "child-output") {
    return event.data;
  }

  if (event.event === "failed") {
    return `${colors.red("✗")} ${colors.bold(event.command)} ${colors.red(`failed (exit ${event.data.exitCode})`)} ${colors.dim("—")} ${colors.red(event.data.message)}\n`;
  }

  if (event.event === "message") {
    const passed = event.data.passed;
    if (typeof passed === "boolean") {
      const detail = stripStatusPrefix(event.data.message);
      return `${passed ? colors.green("✓") : colors.red("✗")} ${passed ? colors.green(detail) : colors.red(detail)}\n`;
    }

    const mark = event.stream === "stderr" ? colors.red("!") : colors.cyan("·");
    return `${mark} ${event.data.message}\n`;
  }

  if (event.event === "started") {
    return `${colors.cyan("→")} ${colors.bold(event.command)} ${colors.dim("started")}\n`;
  }

  return `${colors.green("✓")} ${colors.bold(event.command)} ${colors.dim("ready")}\n`;
}

export const layer = (mode: Mode, options: Options = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const stdio = yield* Stdio.Stdio;

      const write = Effect.fn("Output.write")(function* (event: Event) {
        const text =
          mode === "human"
            ? humanText(
                event,
                options.color === undefined
                  ? event.stream === "stderr"
                    ? chalkStderr
                    : new Chalk()
                  : new Chalk({ level: options.color ? 1 : 0 }),
              )
            : `${JSON.stringify({
                command: event.command,
                data: "data" in event ? event.data : undefined,
                event: event.event,
                stream: event.stream,
                time: new Date(yield* Clock.currentTimeMillis).toISOString(),
                version: 1,
              })}\n`;
        const sink =
          event.stream === "stdout"
            ? stdio.stdout({ endOnDone: false })
            : stdio.stderr({ endOnDone: false });

        yield* Stream.make(text).pipe(Stream.run(sink));
      });

      return Service.of({ write });
    }),
  );

export * as Output from "./output.ts";
