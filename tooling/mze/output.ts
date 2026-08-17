import { Chalk, chalkStderr, type ChalkInstance } from "chalk";
import { Clock, Context, Effect, Layer, Option, Stdio, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";

import { elapsed, Renderer } from "./renderer.ts";

export type Mode = "human" | "json";
export type OutputStream = "stderr" | "stdout";

type MessageData =
  | {
      readonly message: string;
      readonly detail?: string;
      readonly name?: never;
      readonly passed?: never;
      readonly postgres?: never;
      readonly redis?: never;
    }
  | {
      readonly detail?: string;
      readonly message: string;
      readonly name: string;
      readonly passed: boolean;
      readonly postgres?: never;
      readonly redis?: never;
    }
  | {
      readonly message: string;
      readonly postgres: number;
      readonly redis: number;
      readonly detail?: never;
      readonly name?: never;
      readonly passed?: never;
    };

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
      readonly data: MessageData;
      readonly event: "message";
    })
  | (BaseEvent & {
      readonly data: { readonly phases: ReadonlyArray<string> };
      readonly event: "phase-plan";
    })
  | (BaseEvent & {
      readonly data: { readonly phase: string; readonly elapsedMillis?: number };
      readonly event: "phase-started" | "phase-succeeded" | "phase-failed";
    })
  | (BaseEvent & {
      readonly event: "started";
    })
  | (BaseEvent & {
      readonly data?: { readonly elapsedMillis: number };
      readonly event: "succeeded";
    });

export interface Interface {
  readonly write: (event: Event) => Effect.Effect<void, PlatformError>;
}

export class Service extends Context.Service<Service, Interface>()("@mze-store/tooling/Output") {}

export interface Options {
  /** Force color in tests. Omit this field to use Chalk's stream detection. */
  readonly color?: boolean;
}

const indent = (text: string, prefix = "  "): string =>
  text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");

function humanText(event: Event, colors: ChalkInstance): string {
  if (event.event === "child-output") {
    return event.data;
  }

  // Phase rows belong to the renderer, which owns the cursor. Printing them
  // here too would duplicate every row and corrupt a live frame.
  if (
    event.event === "phase-plan" ||
    event.event === "phase-started" ||
    event.event === "phase-succeeded" ||
    event.event === "phase-failed"
  ) {
    return "";
  }

  if (event.event === "failed") {
    return `${colors.red("✗")} ${colors.bold(event.command)} ${colors.dim(`failed (exit ${event.data.exitCode})`)} ${colors.dim("—")} ${event.data.message}\n`;
  }

  if (event.event === "message") {
    const rowIndent = event.command === "doctor" ? "  " : "";
    const detailIndent = `${rowIndent}  `;
    if ("name" in event.data && "passed" in event.data) {
      const mark = event.data.passed ? colors.green("✓") : colors.red("✗");
      const detail =
        event.data.detail !== undefined && event.data.detail.length > 0
          ? `\n${indent(colors.dim(event.data.detail), detailIndent)}`
          : "";
      return `${rowIndent}${mark} ${colors.bold(event.data.name)}${detail}\n`;
    }

    const mark = event.stream === "stderr" ? colors.red("!") : colors.cyan("·");
    return `${rowIndent}${mark} ${event.data.message}\n`;
  }

  if (event.event === "started") {
    return `${colors.cyan("→")} ${colors.bold(event.command)} ${colors.dim("started")}\n`;
  }

  if (event.event === "succeeded") {
    const took = event.data === undefined ? "" : ` ${elapsed(event.data.elapsedMillis)}`;
    return `${colors.green("✔")} ${colors.bold(event.command)} ${colors.dim(`ready${took}`)}\n`;
  }

  return "";
}

export const layer = (mode: Mode, options: Options = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const stdio = yield* Stdio.Stdio;
      // Present only for the batch commands that draw phase rows. When it is
      // there it owns the terminal, so child output becomes a row's tail
      // instead of scrolling past.
      const renderer = yield* Effect.serviceOption(Renderer.Service);

      const write = Effect.fn("Output.write")(function* (event: Event) {
        if (mode === "human" && Option.isSome(renderer)) {
          if (event.event === "child-output") {
            return yield* renderer.value.childOutput(event.data, event.stream);
          }

          // The row list says the command started, so the banner would only
          // repeat it above a block that is about to redraw.
          if (event.event === "started") {
            return;
          }
        }

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
                version: 2,
              })}\n`;

        if (text === "") {
          return;
        }

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
