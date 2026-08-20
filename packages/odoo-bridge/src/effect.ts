import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
  Stream,
} from "effect";

import {
  ODOO_BRIDGE_METHOD,
  ODOO_BRIDGE_MODEL,
  OdooBridgeConfigSchema,
  OdooCatalogBatchRequestSchema,
  OdooCatalogBatchSchema,
  OdooDocumentationIndexSchema,
  OdooModelDocumentationSchema,
  type OdooBridgeConfig,
  type OdooCatalogBatch,
  type OdooCatalogBatchRequest,
  type OdooCatalogBatchRequestInput,
  type OdooCatalogCursor,
  type OdooCatalogItem,
  type OdooDocumentationIndex,
  type OdooModelDocumentation,
} from "./contract";

const PRIVATE_ENDPOINTS = new Set([
  "https://odoo.eden.mizonaecologica.es",
  "http://odoo.odoo.svc.cluster.local:8069",
]);

export const ODOO_BRIDGE_ERROR_CODES = [
  "private_endpoint_required",
  "configuration_invalid",
  "documentation_unavailable",
  "authentication_failed",
  "permission_denied",
  "bridge_method_missing",
  "bridge_method_not_readonly",
  "catalog_fixture_missing",
  "http_error",
  "transport_error",
  "invalid_response",
  "timeout",
  "cancelled",
  "pagination_cycle",
  "pagination_limit_exceeded",
] as const;

export type OdooBridgeErrorCode = (typeof ODOO_BRIDGE_ERROR_CODES)[number];

export class OdooBridgeError extends Schema.TaggedError<OdooBridgeError>()("OdooBridgeError", {
  attempts: Schema.optionalKey(Schema.Int),
  code: Schema.Literals(ODOO_BRIDGE_ERROR_CODES),
  message: Schema.String,
  operation: Schema.String,
  retryable: Schema.Boolean,
  status: Schema.optionalKey(Schema.Int),
}) {}

export type OdooRequest = (input: string, init: RequestInit) => Promise<Response>;

export type OdooCallOptions = {
  readonly signal?: AbortSignal;
  readonly timeout?: Duration.Input;
};

export type OdooCatalogReadOptions = OdooCallOptions & {
  readonly cursor?: OdooCatalogCursor | null;
  readonly maxItems?: number;
  readonly maxPages?: number;
  readonly pageSize?: number;
};

type NormalizedCatalogReadOptions = Required<
  Pick<OdooCatalogReadOptions, "maxItems" | "maxPages" | "pageSize">
> &
  Pick<OdooCatalogReadOptions, "cursor"> &
  OdooCallOptions;

export type OdooCatalogPage = {
  readonly attempts: number;
  readonly batch: OdooCatalogBatch;
  readonly requestCursor: OdooCatalogCursor | null;
  readonly sequence: number;
};

export type OdooReadOnlyContract = {
  readonly catalog: OdooCatalogBatch;
  readonly documentation: {
    readonly index: OdooDocumentationIndex;
    readonly model: OdooModelDocumentation;
  };
  readonly method: `${typeof ODOO_BRIDGE_MODEL}/${typeof ODOO_BRIDGE_METHOD}`;
};

export type OdooBridgeSettings = {
  readonly apiKey: Redacted.Redacted<string>;
  readonly baseUrl: string;
  readonly database: string;
  readonly maxAttempts?: number;
  readonly maxItems?: number;
  readonly maxPages?: number;
  readonly request?: OdooRequest;
  readonly requestTimeout?: Duration.Input;
};

export type OdooJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly OdooJsonValue[]
  | { readonly [key: string]: OdooJsonValue };

export type OdooTransportRequest = {
  readonly body?: OdooJsonValue;
  readonly method: "GET" | "POST";
  readonly operation: string;
  readonly path: string;
  readonly signal?: AbortSignal;
  readonly timeout?: Duration.Input;
};

export type OdooTransportResponse = {
  readonly attempts: number;
  readonly body: unknown;
  readonly status: number;
};

export type OdooTransportContract = {
  readonly request: (
    request: OdooTransportRequest,
  ) => Effect.Effect<OdooTransportResponse, OdooBridgeError>;
};

export class OdooTransport extends Context.Service<OdooTransport, OdooTransportContract>()(
  "@mze-store/odoo-bridge/OdooTransport",
) {}

export type OdooCatalogSession = {
  readonly contract: OdooReadOnlyContract;
  readonly items: (
    options?: OdooCatalogReadOptions,
  ) => Stream.Stream<OdooCatalogItem, OdooBridgeError>;
  readonly pages: (
    options?: OdooCatalogReadOptions,
  ) => Stream.Stream<OdooCatalogPage, OdooBridgeError>;
};

export type OdooBridgeContract = {
  readonly open: (options?: OdooCallOptions) => Effect.Effect<OdooCatalogSession, OdooBridgeError>;
  readonly readAllCatalog: (
    options?: OdooCatalogReadOptions,
  ) => Effect.Effect<ReadonlyArray<OdooCatalogItem>, OdooBridgeError>;
  readonly readCatalogBatch: (
    request?: OdooCatalogBatchRequestInput,
    options?: OdooCallOptions,
  ) => Effect.Effect<OdooCatalogBatch, OdooBridgeError>;
  readonly readCatalogPages: (
    options?: OdooCatalogReadOptions,
  ) => Stream.Stream<OdooCatalogPage, OdooBridgeError>;
  readonly verify: (
    options?: OdooCallOptions,
  ) => Effect.Effect<OdooReadOnlyContract, OdooBridgeError>;
};

export class OdooBridge extends Context.Service<OdooBridge, OdooBridgeContract>()(
  "@mze-store/odoo-bridge/OdooBridge",
) {}

type NormalizedSettings = {
  readonly apiKey: Redacted.Redacted<string>;
  readonly baseUrl: string;
  readonly database: string;
  readonly maxAttempts: number;
  readonly maxItems: number;
  readonly maxPages: number;
  readonly request: OdooRequest;
  readonly requestTimeout: Duration.Input;
};

export function isPrivateOdooEndpoint(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      PRIVATE_ENDPOINTS.has(url.origin) &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function normalizeSettings(settings: OdooBridgeSettings): NormalizedSettings {
  if (!Redacted.isRedacted(settings.apiKey) || Redacted.value(settings.apiKey).length === 0) {
    throw bridgeError(
      "configuration_invalid",
      "bridge.config",
      "ODOO_API_KEY must contain a value.",
    );
  }

  let config: OdooBridgeConfig;
  try {
    config = Schema.decodeUnknownSync(OdooBridgeConfigSchema)({
      apiKey: Redacted.value(settings.apiKey),
      baseUrl: settings.baseUrl,
      database: settings.database,
    });
  } catch {
    throw bridgeError(
      "configuration_invalid",
      "bridge.config",
      "Odoo bridge configuration is invalid.",
    );
  }

  if (!isPrivateOdooEndpoint(config.baseUrl)) {
    throw bridgeError(
      "private_endpoint_required",
      "bridge.config",
      "ODOO_BASE_URL must use the private Odoo route or cluster service.",
    );
  }

  const maxAttempts = settings.maxAttempts ?? 3;
  const maxItems = settings.maxItems ?? 100_000;
  const maxPages = settings.maxPages ?? 100;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw bridgeError("configuration_invalid", "bridge.config", "maxAttempts must be at least 1.");
  }
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw bridgeError("configuration_invalid", "bridge.config", "maxItems must be at least 1.");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw bridgeError("configuration_invalid", "bridge.config", "maxPages must be at least 1.");
  }

  const baseUrl = new URL(config.baseUrl);
  baseUrl.pathname = baseUrl.pathname.replace(/\/$/u, "");

  return {
    apiKey: settings.apiKey,
    baseUrl: baseUrl.toString().replace(/\/$/u, ""),
    database: config.database,
    maxAttempts,
    maxItems,
    maxPages,
    request: settings.request ?? ((input, init) => globalThis.fetch(input, init)),
    requestTimeout: settings.requestTimeout ?? "20 seconds",
  };
}

export function transportLayer(settings: OdooBridgeSettings): Layer.Layer<OdooTransport> {
  const normalized = normalizeSettings(settings);
  return Layer.succeed(OdooTransport, makeTransport(normalized));
}

export function layerWithTransport(
  settings: OdooBridgeSettings,
): Layer.Layer<OdooBridge, never, OdooTransport> {
  normalizeSettings(settings);
  return Layer.effect(OdooBridge, makeBridge(settings));
}

export function layer(settings: OdooBridgeSettings): Layer.Layer<OdooBridge> {
  return layerWithTransport(settings).pipe(Layer.provide(transportLayer(settings)));
}

function makeTransport(settings: NormalizedSettings): OdooTransportContract {
  return {
    request: (request) => {
      let attempts = 0;
      const requestOnce = Effect.gen(function* () {
        attempts += 1;
        const response = yield* Effect.tryPromise({
          try: (signal) => {
            const requestSignal = request.signal
              ? AbortSignal.any([signal, request.signal])
              : signal;
            return settings.request(`${settings.baseUrl}${request.path}`, {
              body: request.body === undefined ? undefined : JSON.stringify(request.body),
              headers: {
                Authorization: `bearer ${Redacted.value(settings.apiKey)}`,
                "Cache-Control": "no-cache",
                "Content-Type": "application/json",
                "User-Agent": "mze-store/odoo-bridge",
                "X-Odoo-Database": settings.database,
              },
              method: request.method,
              signal: requestSignal,
            });
          },
          catch: (cause) =>
            bridgeError(
              request.signal?.aborted ? "cancelled" : "transport_error",
              request.operation,
              `Odoo ${request.operation} request failed.${redactCause(cause, settings.apiKey)}`,
              undefined,
              request.signal?.aborted ? false : true,
              attempts,
            ),
        });

        if (!response.ok) {
          const { code, retryable } = classifyStatus(response.status);
          return yield* Effect.fail(
            bridgeError(
              code,
              request.operation,
              `Odoo ${request.operation} request failed with HTTP ${response.status}.`,
              response.status,
              retryable,
              attempts,
            ),
          );
        }

        const body = yield* Effect.tryPromise({
          try: () => response.json() as Promise<unknown>,
          catch: (cause) =>
            bridgeError(
              "invalid_response",
              request.operation,
              `Odoo ${request.operation} response failed to decode.${redactCause(cause, settings.apiKey)}`,
              response.status,
              false,
              attempts,
            ),
        });

        return { attempts, body, status: response.status } satisfies OdooTransportResponse;
      });

      const timeout = request.timeout ?? settings.requestTimeout;
      const timed = requestOnce.pipe(Effect.timeoutOption(timeout));
      const bounded = timed.pipe(
        Effect.flatMap((result) =>
          Option.isNone(result)
            ? Effect.fail(
                bridgeError(
                  "timeout",
                  request.operation,
                  `Odoo ${request.operation} exceeded its timeout.`,
                  undefined,
                  false,
                  attempts,
                ),
              )
            : Effect.succeed(result.value),
        ),
      );

      if (settings.maxAttempts === 1) {
        return bounded;
      }

      return bounded.pipe(
        Effect.retry({
          schedule: Schedule.exponential("100 millis").pipe(
            Schedule.jittered,
            Schedule.upTo({ times: settings.maxAttempts - 1 }),
          ),
          while: (error) => error.retryable,
        }),
      );
    },
  };
}

function makeBridge(
  settings: OdooBridgeSettings,
): Effect.Effect<OdooBridgeContract, never, OdooTransport> {
  const normalized = normalizeSettings(settings);

  return Effect.gen(function* () {
    const transport = yield* OdooTransport;
    const readIndexRaw = (options?: OdooCallOptions) =>
      requestJson(
        transport,
        "GET",
        "/doc-bearer/index.json",
        undefined,
        OdooDocumentationIndexSchema,
        "documentation.index",
        normalized,
        options,
      );
    const readModelRaw = (options?: OdooCallOptions) =>
      requestJson(
        transport,
        "GET",
        `/doc-bearer/${encodeURIComponent(ODOO_BRIDGE_MODEL)}.json`,
        undefined,
        OdooModelDocumentationSchema,
        "documentation.model",
        normalized,
        options,
      );
    const readBatchRaw = (request: OdooCatalogBatchRequestInput = {}, options?: OdooCallOptions) =>
      decodeRequest(request).pipe(
        Effect.flatMap((input) =>
          Schema.encodeEffect(Schema.toCodecJson(OdooCatalogBatchRequestSchema))(input).pipe(
            Effect.mapError(() =>
              bridgeError(
                "configuration_invalid",
                "catalog.batch",
                "Catalog batch request is invalid.",
              ),
            ),
            Effect.flatMap((body) =>
              requestJson(
                transport,
                "POST",
                `/json/2/${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`,
                body,
                OdooCatalogBatchSchema,
                "catalog.batch",
                normalized,
                options,
              ),
            ),
          ),
        ),
      );

    const verifyRaw = (options?: OdooCallOptions) =>
      Effect.gen(function* () {
        const index = yield* readIndexRaw(options).pipe(
          Effect.mapError((error) => documentationError(error)),
        );
        const model = yield* readModelRaw(options).pipe(
          Effect.mapError((error) => documentationError(error)),
        );
        const documentedModel = index.models.find(({ model: name }) => name === ODOO_BRIDGE_MODEL);

        if (!documentedModel?.methods.includes(ODOO_BRIDGE_METHOD)) {
          return yield* Effect.fail(
            bridgeError(
              "bridge_method_missing",
              "bridge.verify",
              `Odoo does not document ${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}.`,
            ),
          );
        }
        if (model.model !== ODOO_BRIDGE_MODEL) {
          return yield* Effect.fail(
            bridgeError(
              "bridge_method_missing",
              "bridge.verify",
              `Odoo model documentation is for ${model.model}, not ${ODOO_BRIDGE_MODEL}.`,
            ),
          );
        }
        const method = model.methods[ODOO_BRIDGE_METHOD];
        if (method === undefined) {
          return yield* Effect.fail(
            bridgeError(
              "bridge_method_missing",
              "bridge.verify",
              `Odoo model documentation does not include ${ODOO_BRIDGE_METHOD}.`,
            ),
          );
        }
        if (!method.api?.includes("readonly")) {
          return yield* Effect.fail(
            bridgeError(
              "bridge_method_not_readonly",
              "bridge.verify",
              `Odoo method ${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD} is not read-only.`,
            ),
          );
        }

        const catalog = yield* readBatchRaw({ limit: 1 }, options);
        if (catalog.items.length === 0) {
          return yield* Effect.fail(
            bridgeError(
              "catalog_fixture_missing",
              "bridge.verify",
              "Odoo catalog bridge returned no normalized fixture.",
            ),
          );
        }

        return {
          catalog,
          documentation: { index, model },
          method: `${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}` as const,
        } satisfies OdooReadOnlyContract;
      });
    const cachedVerify = yield* Effect.cached(verifyRaw());
    const verify = (options?: OdooCallOptions) =>
      options?.signal === undefined && options?.timeout === undefined
        ? cachedVerify
        : verifyRaw(options);

    const readCatalogPagesForContract = (
      contract: OdooReadOnlyContract,
      options: OdooCatalogReadOptions = {},
    ) =>
      Stream.unwrap(
        normalizeReadOptions(options, normalized).pipe(
          Effect.map((readOptions) => createPageStream(contract, readBatchRaw, readOptions)),
        ),
      );
    const readCatalogPages = (options: OdooCatalogReadOptions = {}) =>
      Stream.unwrap(
        verify({ signal: options.signal, timeout: options.timeout }).pipe(
          Effect.map((contract) => readCatalogPagesForContract(contract, options)),
        ),
      );
    const open = (options?: OdooCallOptions) =>
      verify(options).pipe(
        Effect.map((contract) =>
          createSession(contract, (readOptions) =>
            readCatalogPagesForContract(contract, {
              ...readOptions,
              signal: readOptions?.signal ?? options?.signal,
              timeout: readOptions?.timeout ?? options?.timeout,
            }),
          ),
        ),
      );

    return {
      open,
      readAllCatalog: (options) =>
        Stream.runCollect(readCatalogPages(options)).pipe(
          Effect.map((pages) => Array.from(pages).flatMap((page) => page.batch.items)),
        ),
      readCatalogBatch: (request, options) =>
        verify(options).pipe(Effect.flatMap(() => readBatchRaw(request, options))),
      readCatalogPages,
      verify,
    } satisfies OdooBridgeContract;
  });
}

function createSession(
  contract: OdooReadOnlyContract,
  readCatalogPages: (
    options?: OdooCatalogReadOptions,
  ) => Stream.Stream<OdooCatalogPage, OdooBridgeError>,
): OdooCatalogSession {
  return {
    contract,
    items: (options) =>
      readCatalogPages(options).pipe(
        Stream.flatMap((page) => Stream.fromIterable(page.batch.items)),
      ),
    pages: readCatalogPages,
  };
}

function createPageStream(
  contract: OdooReadOnlyContract,
  readBatchRaw: (
    request?: OdooCatalogBatchRequestInput,
    options?: OdooCallOptions,
  ) => Effect.Effect<OdooCatalogBatch, OdooBridgeError>,
  options: NormalizedCatalogReadOptions,
): Stream.Stream<OdooCatalogPage, OdooBridgeError> {
  type State = {
    readonly attempts: number;
    readonly batch?: OdooCatalogBatch;
    readonly done: boolean;
    readonly itemsRead: number;
    readonly nextCursor: OdooCatalogCursor | null;
    readonly requestCursor: OdooCatalogCursor | null;
    readonly seen: ReadonlySet<string>;
    readonly sequence: number;
  };

  const requestedCursor = options.cursor ?? null;
  const initialState: State =
    requestedCursor === null
      ? {
          attempts: 1,
          batch: contract.catalog,
          done: false,
          itemsRead: 0,
          nextCursor: contract.catalog.next_cursor,
          requestCursor: null,
          seen: new Set(),
          sequence: 1,
        }
      : {
          attempts: 0,
          done: false,
          itemsRead: 0,
          nextCursor: requestedCursor,
          requestCursor: requestedCursor,
          seen: new Set([cursorKey(requestedCursor)]),
          sequence: 1,
        };

  return Stream.unfold(initialState, (state) => {
    if (state.done) {
      return Effect.succeed(undefined);
    }
    if (state.sequence > options.maxPages) {
      return Effect.fail(
        bridgeError(
          "pagination_limit_exceeded",
          "catalog.pages",
          `Catalog pagination exceeded the ${options.maxPages}-page limit.`,
        ),
      );
    }

    const pageEffect =
      state.batch === undefined
        ? readBatchRaw(
            { cursor: state.nextCursor, limit: options.pageSize },
            { signal: options.signal, timeout: options.timeout },
          ).pipe(Effect.map((batch) => ({ attempts: 1, batch })))
        : Effect.succeed({ attempts: state.attempts, batch: state.batch });

    return pageEffect.pipe(
      Effect.flatMap(({ attempts, batch }) => {
        const itemsRead = state.itemsRead + batch.items.length;
        if (itemsRead > options.maxItems) {
          return Effect.fail(
            bridgeError(
              "pagination_limit_exceeded",
              "catalog.pages",
              `Catalog pagination exceeded the ${options.maxItems}-item limit.`,
            ),
          );
        }

        const nextCursor = batch.next_cursor;
        let nextState: State;
        if (nextCursor !== null) {
          const key = cursorKey(nextCursor);
          if (state.seen.has(key)) {
            return Effect.fail(
              bridgeError(
                "pagination_cycle",
                "catalog.pages",
                "Odoo returned a cursor that was already read.",
              ),
            );
          }
          const seen = new Set(state.seen);
          seen.add(key);
          nextState = {
            attempts: 0,
            done: false,
            itemsRead,
            nextCursor,
            requestCursor: nextCursor,
            seen,
            sequence: state.sequence + 1,
          };
        } else {
          nextState = {
            attempts: 0,
            done: true,
            itemsRead,
            nextCursor: null,
            requestCursor: null,
            seen: state.seen,
            sequence: state.sequence + 1,
          };
        }

        return Effect.succeed([
          {
            attempts,
            batch,
            requestCursor: state.requestCursor,
            sequence: state.sequence,
          } satisfies OdooCatalogPage,
          nextState,
        ] as const);
      }),
    );
  });
}

function normalizeReadOptions(
  options: OdooCatalogReadOptions,
  settings: NormalizedSettings,
): Effect.Effect<NormalizedCatalogReadOptions, OdooBridgeError> {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? settings.maxPages;
  const maxItems = options.maxItems ?? settings.maxItems;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return Effect.fail(
      bridgeError("configuration_invalid", "catalog.pages", "pageSize must be between 1 and 100."),
    );
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    return Effect.fail(
      bridgeError("configuration_invalid", "catalog.pages", "maxPages must be at least 1."),
    );
  }
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    return Effect.fail(
      bridgeError("configuration_invalid", "catalog.pages", "maxItems must be at least 1."),
    );
  }
  return Effect.succeed({
    cursor: options.cursor,
    maxItems,
    maxPages,
    pageSize,
    signal: options.signal,
    timeout: options.timeout,
  });
}

function decodeRequest(
  request: OdooCatalogBatchRequestInput,
): Effect.Effect<OdooCatalogBatchRequest, OdooBridgeError> {
  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(Schema.toCodecJson(OdooCatalogBatchRequestSchema))({
        cursor: request.cursor ?? null,
        limit: request.limit ?? 25,
      }),
    catch: () =>
      bridgeError("configuration_invalid", "catalog.batch", "Catalog batch request is invalid."),
  });
}

function requestJson<S extends Schema.Constraint & { readonly DecodingServices: never }>(
  transport: OdooTransportContract,
  method: "GET" | "POST",
  path: string,
  body: OdooJsonValue | undefined,
  schema: S,
  operation: string,
  settings: NormalizedSettings,
  options?: OdooCallOptions,
): Effect.Effect<S["Type"], OdooBridgeError> {
  return transport
    .request({
      body,
      method,
      operation,
      path,
      signal: options?.signal,
      timeout: options?.timeout,
    })
    .pipe(
      Effect.flatMap(({ body: responseBody }) =>
        Schema.decodeUnknownEffect(Schema.toCodecJson(schema))(responseBody).pipe(
          Effect.mapError(() =>
            bridgeError(
              "invalid_response",
              operation,
              `Odoo ${operation} response did not match the bridge contract.`,
            ),
          ),
        ),
      ),
      Effect.mapError((error) => redactError(error, settings.apiKey)),
    );
}

function documentationError(error: OdooBridgeError): OdooBridgeError {
  if (
    error.code !== "http_error" &&
    error.code !== "transport_error" &&
    error.code !== "invalid_response"
  ) {
    return error;
  }
  return bridgeError(
    "documentation_unavailable",
    error.operation,
    error.message,
    error.status,
    error.retryable,
    error.attempts,
  );
}

function classifyStatus(status: number) {
  if (status === 401) return { code: "authentication_failed", retryable: false } as const;
  if (status === 403) return { code: "permission_denied", retryable: false } as const;
  if (status === 408 || status === 429 || status >= 500)
    return { code: "http_error", retryable: true } as const;
  return { code: "http_error", retryable: false } as const;
}

function cursorKey(cursor: OdooCatalogCursor): string {
  return `${cursor.id}:${cursor.write_date}`;
}

function redactCause(cause: unknown, apiKey: Redacted.Redacted<string>): string {
  if (!(cause instanceof Error)) return "";
  const message = cause.message.replaceAll(Redacted.value(apiKey), "[redacted]");
  return message.length === 0 ? "" : ` ${message}`;
}

function redactError(error: OdooBridgeError, apiKey: Redacted.Redacted<string>): OdooBridgeError {
  const redactedMessage = error.message.replaceAll(Redacted.value(apiKey), "[redacted]");
  if (redactedMessage === error.message) return error;
  return bridgeError(
    error.code,
    error.operation,
    redactedMessage,
    error.status,
    error.retryable,
    error.attempts,
  );
}

function bridgeError(
  code: OdooBridgeErrorCode,
  operation: string,
  message: string,
  status?: number,
  retryable = false,
  attempts?: number,
): OdooBridgeError {
  type BridgeErrorFields = {
    readonly code: OdooBridgeErrorCode;
    readonly message: string;
    readonly operation: string;
    readonly retryable: boolean;
    attempts?: number;
    status?: number;
  };
  const fields: BridgeErrorFields = {
    code,
    message,
    operation,
    retryable,
  };
  if (attempts !== undefined) fields.attempts = attempts;
  if (status !== undefined) fields.status = status;
  return new OdooBridgeError(fields);
}
