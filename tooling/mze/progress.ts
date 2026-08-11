import type { Writable } from "node:stream";

import yoctoSpinner, { type Spinner } from "yocto-spinner";
import { Context, Effect, Layer, Semaphore } from "effect";

export interface ProgressOptions {
  readonly command: string;
  readonly message: string;
}

export interface Interface {
  /** Run quiet work with one transient spinner owned by this scope. */
  readonly withProgress: <A, E, R>(
    options: ProgressOptions,
    use: (update: (message: string) => Effect.Effect<void>) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export class Service extends Context.Service<Service, Interface>()("@mze-store/tooling/Progress") {}

interface TerminalStream extends Writable {
  readonly isTTY?: boolean;
}

export interface Options {
  readonly stream?: TerminalStream;
  readonly tty?: boolean;
  readonly term?: string;
  readonly ci?: boolean;
}

const noUpdate = (_message: string): Effect.Effect<void> => Effect.void;

const enabled = (mode: "human" | "json", options: Options, stream: TerminalStream): boolean =>
  mode === "human" &&
  (options.tty ?? stream.isTTY === true) &&
  (options.term ?? process.env.TERM) !== "dumb" &&
  !(options.ci ?? "CI" in process.env);

export const layer = (mode: "human" | "json", options: Options = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const stream = options.stream ?? (process.stderr as TerminalStream);
      const active = yield* Semaphore.make(1);
      const canRender = enabled(mode, options, stream);

      const withProgress = <A, E, R>(
        progress: ProgressOptions,
        use: (update: (message: string) => Effect.Effect<void>) => Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E, R> => {
        if (!canRender) {
          return use(noUpdate);
        }

        return Effect.gen(function* () {
          if (!(yield* active.takeIfAvailable(1))) {
            return yield* use(noUpdate);
          }

          return yield* Effect.acquireUseRelease(
            Effect.try({
              try: () =>
                yoctoSpinner({
                  handleSignals: false,
                  stream,
                  text: progress.message,
                }).start(),
              catch: () => undefined,
            }),
            (spinner: Spinner | undefined) =>
              spinner === undefined
                ? use(noUpdate)
                : use((message) =>
                    Effect.sync(() => {
                      spinner.text = message;
                    }),
                  ),
            (spinner: Spinner | undefined) =>
              Effect.sync(() => {
                spinner?.stop();
              }).pipe(Effect.zipRight(active.release(1)), Effect.asVoid),
          );
        });
      };

      return Service.of({ withProgress });
    }),
  );

export * as Progress from "./progress.ts";
