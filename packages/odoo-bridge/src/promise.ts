import { Duration, Effect, Redacted, Stream } from "effect";

import {
  OdooBridge,
  OdooBridgeError,
  type OdooBridgeSettings,
  layer,
  type OdooCallOptions,
  type OdooCatalogPage,
  type OdooCatalogReadOptions,
  type OdooReadOnlyContract,
  type OdooRequest,
} from "./effect";
import type {
  OdooBridgeConfig,
  OdooCatalogBatch,
  OdooCatalogBatchRequestInput,
  OdooCatalogItem,
} from "./contract";

export type OdooPromiseCallOptions = {
  readonly signal?: AbortSignal;
  /** Total time allowed for one Promise operation, in milliseconds. */
  readonly timeoutMs?: number;
};

export type OdooPromiseBridgeOptions = OdooBridgeConfig & {
  readonly maxAttempts?: number;
  readonly maxItems?: number;
  readonly maxPages?: number;
  readonly request?: OdooRequest;
  readonly requestTimeoutMs?: number;
};

export type OdooPromiseBridge = {
  readonly readAllCatalog: (
    options?: OdooCatalogReadOptions & OdooPromiseCallOptions,
  ) => Promise<ReadonlyArray<OdooCatalogItem>>;
  readonly readCatalogBatch: (
    request?: OdooCatalogBatchRequestInput,
    options?: OdooPromiseCallOptions,
  ) => Promise<OdooCatalogBatch>;
  readonly readCatalogPages: (
    options?: OdooCatalogReadOptions & OdooPromiseCallOptions,
  ) => AsyncIterable<OdooCatalogPage>;
  readonly verify: (options?: OdooPromiseCallOptions) => Promise<OdooReadOnlyContract>;
};

export function createPromiseBridge(options: OdooPromiseBridgeOptions): OdooPromiseBridge {
  const settings: OdooBridgeSettings = {
    apiKey: Redacted.make(options.apiKey),
    baseUrl: options.baseUrl,
    database: options.database,
    maxAttempts: options.maxAttempts,
    maxItems: options.maxItems,
    maxPages: options.maxPages,
    request: options.request,
    requestTimeout:
      options.requestTimeoutMs === undefined
        ? undefined
        : Duration.millis(options.requestTimeoutMs),
  };

  // Layer construction validates the route and static limits before the first
  // request. Runtime failures remain typed OdooBridgeError values.
  const bridgeLayer = layer(settings);
  const run = async <A>(
    program: Effect.Effect<A, OdooBridgeError>,
    call?: OdooPromiseCallOptions,
  ) => {
    try {
      return await Effect.runPromise(withDeadline(program, call?.timeoutMs), {
        signal: call?.signal,
      });
    } catch (error) {
      if (call?.signal?.aborted) {
        throw new OdooBridgeError({
          code: "cancelled",
          message: "Odoo bridge operation was cancelled.",
          operation: "bridge.operation",
          retryable: false,
        });
      }
      throw error;
    }
  };

  return {
    readAllCatalog: (readOptions = {}) => {
      const optionsWithCall = readOptions as OdooCatalogReadOptions & OdooPromiseCallOptions;
      const { signal, timeoutMs, ...catalogOptions } = optionsWithCall;
      return run(
        Effect.gen(function* () {
          const bridge = yield* OdooBridge;
          return yield* bridge.readAllCatalog({ ...catalogOptions, signal });
        }).pipe(Effect.provide(bridgeLayer)),
        { signal, timeoutMs },
      );
    },
    readCatalogBatch: (request, call) =>
      run(
        Effect.gen(function* () {
          const bridge = yield* OdooBridge;
          const options: OdooCallOptions | undefined = call
            ? {
                signal: call.signal,
              }
            : undefined;
          return yield* bridge.readCatalogBatch(request, options);
        }).pipe(Effect.provide(bridgeLayer)),
        call,
      ),
    readCatalogPages: (readOptions = {}) => {
      const optionsWithCall = readOptions as OdooCatalogReadOptions & OdooPromiseCallOptions;
      const { timeoutMs, ...catalogOptions } = optionsWithCall;
      const makeIterable = (signal?: AbortSignal) => {
        const stream = Stream.unwrap(
          Effect.gen(function* () {
            const bridge = yield* OdooBridge;
            return bridge.readCatalogPages({ ...catalogOptions, signal });
          }).pipe(Effect.provide(bridgeLayer)),
        );
        return Stream.toAsyncIterable(stream);
      };
      const iterable = makeIterable(catalogOptions.signal);
      return timeoutMs === undefined
        ? iterable
        : withIterationTimeout(makeIterable, timeoutMs, catalogOptions.signal);
    },
    verify: (call) =>
      run(
        Effect.gen(function* () {
          const bridge = yield* OdooBridge;
          return yield* bridge.verify(call ? { signal: call.signal } : undefined);
        }).pipe(Effect.provide(bridgeLayer)),
        call,
      ),
  };
}

function withDeadline<A>(
  program: Effect.Effect<A, OdooBridgeError>,
  timeoutMs: number | undefined,
): Effect.Effect<A, OdooBridgeError> {
  if (timeoutMs === undefined) return program;
  return program.pipe(
    Effect.timeoutOption(Duration.millis(timeoutMs)),
    Effect.flatMap((result) =>
      result._tag === "None"
        ? Effect.fail(
            new OdooBridgeError({
              code: "timeout",
              message: "Odoo bridge operation exceeded its timeout.",
              operation: "bridge.operation",
              retryable: false,
            }),
          )
        : Effect.succeed(result.value),
    ),
  );
}

function withIterationTimeout<A>(
  makeIterable: (signal: AbortSignal) => AsyncIterable<A>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): AsyncIterable<A> {
  return {
    [Symbol.asyncIterator]() {
      const timeoutController = new AbortController();
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, timeoutController.signal])
        : timeoutController.signal;
      const iterator = makeIterable(signal)[Symbol.asyncIterator]();
      let closed = false;
      let timedOut = false;
      let pendingReject: ((reason?: OdooBridgeError) => void) | undefined;
      const timeoutError = () =>
        new OdooBridgeError({
          code: "timeout",
          message: "Catalog iteration exceeded its timeout.",
          operation: "catalog.pages",
          retryable: false,
        });
      const closeUnderlying = () => {
        const closing = iterator.return?.();
        if (closing) void closing.catch(() => undefined);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
        pendingReject?.(timeoutError());
        pendingReject = undefined;
        closeUnderlying();
      }, timeoutMs);
      return {
        next: () => {
          if (timedOut) return Promise.reject(timeoutError());
          if (closed) return Promise.resolve({ done: true, value: undefined } as const);
          return new Promise<IteratorResult<A>>((resolve, reject) => {
            pendingReject = reject;
            void iterator.next().then(
              (result) => {
                pendingReject = undefined;
                if (timedOut) return;
                if (result.done) {
                  closed = true;
                  clearTimeout(timer);
                }
                resolve(result);
              },
              (error) => {
                pendingReject = undefined;
                if (timedOut) return;
                reject(error);
              },
            );
          });
        },
        return: () => {
          closed = true;
          clearTimeout(timer);
          timeoutController.abort();
          return iterator.return?.() ?? Promise.resolve({ done: true, value: undefined } as const);
        },
        throw: (error: Error) => {
          closed = true;
          clearTimeout(timer);
          timeoutController.abort();
          return iterator.throw?.(error) ?? Promise.reject(error);
        },
      };
    },
  };
}

export { OdooBridgeError };
