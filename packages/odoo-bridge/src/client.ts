import { Cause, Data, Effect, Exit, Layer, ManagedRuntime, Redacted, Result, Struct } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import type { BridgeContractCheck, CatalogBatch, CatalogBatchInput } from "./contract";
import {
  OdooBridgeCallAborted,
  OdooBridgeClientClosed,
  type CallError,
  type CheckContractError,
  type ConfigurationError,
  type ReadCatalogBatchError,
} from "./error";
import { OdooBridge } from "./odoo-bridge";
import { decodeSettings, type Settings } from "~/internal/options";

export interface CallOptions {
  readonly signal?: AbortSignal | undefined;
}

export interface ReadCatalogBatchOptions extends CallOptions {
  readonly cursor?: CatalogBatchInput["cursor"];
  readonly limit?: CatalogBatchInput["limit"];
}

export interface Options {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly database: string;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly requestTimeoutMs?: number | undefined;
}

export type OdooBridgeResult<A, E> = Result.Result<A, E>;
export type OdooBridgeAsyncResult<A, E> = Promise<OdooBridgeResult<A, E>>;
export type CreateOdooBridgeResult = OdooBridgeResult<OdooBridgeClient, ConfigurationError>;
export type CheckContractResult = OdooBridgeResult<
  BridgeContractCheck,
  CallError | CheckContractError
>;
export type ReadCatalogBatchResult = OdooBridgeResult<
  CatalogBatch,
  CallError | ReadCatalogBatchError
>;

export interface OdooBridgeGateway {
  readonly readCatalogBatch: (options?: ReadCatalogBatchOptions) => Promise<ReadCatalogBatchResult>;
}

export interface OdooBridgeClient extends OdooBridgeGateway, AsyncDisposable {
  readonly checkContract: (options?: CallOptions) => Promise<CheckContractResult>;
  readonly close: () => Promise<void>;
}

type ClientState = Data.TaggedEnum<{
  Closed: {};
  Closing: { readonly completion: Promise<void> };
  Open: {};
}>;

const ClientState = Data.taggedEnum<ClientState>();

export function createOdooBridge(options: Options): CreateOdooBridgeResult {
  const settings = decodeSettings({
    apiKey: Redacted.make(options.apiKey),
    baseUrl: options.baseUrl,
    database: options.database,
    requestTimeout: options.requestTimeoutMs,
  });

  return Result.map(settings, (settings) =>
    makeRuntimeClient(settings, options.fetch ?? globalThis.fetch),
  );
}

function makeRuntimeClient(settings: Settings, fetch: typeof globalThis.fetch): OdooBridgeClient {
  const runtime = ManagedRuntime.make(
    OdooBridge.layer(settings).pipe(Layer.provide(FetchHttpClient.layer), Layer.orDie),
  );
  let state: ClientState = ClientState.Open();

  const run = <A, E>(
    program: Effect.Effect<A, E, OdooBridge.Service>,
    options?: CallOptions,
  ): OdooBridgeAsyncResult<A, E | CallError> => {
    if (!ClientState.$is("Open")(state)) {
      return Promise.resolve(Result.fail(new OdooBridgeClientClosed({})));
    }

    return runtime
      .runPromiseExit(
        program.pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), Effect.result),
        { signal: options?.signal },
      )
      .then((exit) => {
        if (Exit.isSuccess(exit)) return exit.value;
        if (Cause.hasInterruptsOnly(exit.cause)) {
          return Result.fail(interruptionError(options?.signal));
        }
        return Promise.reject(Cause.squash(exit.cause));
      });
  };

  const close = (): Promise<void> =>
    ClientState.$match(state, {
      Closed: () => Promise.resolve(),
      Closing: ({ completion }) => completion,
      Open: () => {
        const completion = runtime.dispose().then(() => {
          state = ClientState.Closed();
        });
        state = ClientState.Closing({ completion });
        return completion;
      },
    });

  return {
    [Symbol.asyncDispose]: close,
    checkContract: (options) => run(OdooBridge.checkContract, options),
    close,
    readCatalogBatch: (options) =>
      run(
        OdooBridge.readCatalogBatch(
          options === undefined ? undefined : Struct.pick(options, ["cursor", "limit"]),
        ),
        options,
      ),
  };
}

function interruptionError(signal?: AbortSignal): CallError {
  return signal?.aborted === true ? new OdooBridgeCallAborted({}) : new OdooBridgeClientClosed({});
}
