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

function humanText(event: Event): string {
  if (event.event === "child-output") {
    return event.data;
  }

  if (event.event === "failed" || event.event === "message") {
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
