import { Clock, Context, Effect, Layer, Stdio, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";

export type Mode = "human" | "json";
export type OutputStream = "stderr" | "stdout";

export interface Event {
  readonly command: string;
  readonly data?: unknown;
  readonly event: "child-output" | "failed" | "message" | "started" | "succeeded";
  readonly stream: OutputStream;
}

export interface Interface {
  readonly write: (event: Event) => Effect.Effect<void, PlatformError>;
}

export class Service extends Context.Service<Service, Interface>()("@mze-store/tooling/Output") {}

function humanText(event: Event): string {
  if (event.event === "child-output" && typeof event.data === "string") {
    return event.data;
  }

  if (
    event.event === "child-output" &&
    typeof event.data === "object" &&
    event.data !== null &&
    "text" in event.data &&
    typeof event.data.text === "string"
  ) {
    return event.data.text;
  }

  if (
    typeof event.data === "object" &&
    event.data !== null &&
    "message" in event.data &&
    typeof event.data.message === "string"
  ) {
    return `${event.data.message}\n`;
  }

  return `${event.command}: ${event.event}\n`;
}

export const layer = (mode: Mode) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const stdio = yield* Stdio.Stdio;

      const write = Effect.fn("Output.write")(function* (event: Event) {
        const text =
          mode === "human"
            ? humanText(event)
            : `${JSON.stringify({
                command: event.command,
                data: event.data,
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
