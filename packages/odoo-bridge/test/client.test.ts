import { Effect, Layer, Redacted, Result, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect, it } from "vite-plus/test";

import { createOdooBridge } from "~/client";
import {
  CatalogBatchSchema,
  ODOO_BRIDGE_METHOD,
  ODOO_BRIDGE_MODEL,
  ODOO_BRIDGE_MODULE,
  type CatalogBatch,
} from "~/contract";
import { OdooBridge } from "~/effect";
import type { Options } from "~/index";

const options = {
  apiKey: "odoo-test-api-key",
  baseUrl: "https://odoo.eden.mizonaecologica.es",
  database: "odoo",
} as const satisfies Options;

const catalogWire = {
  contract_version: "mze.odoo.catalog.v1",
  items: [
    {
      template: {
        active: true,
        currency: "EUR",
        description: null,
        id: 352,
        integration_key: "3f8c5e48-4aa9-4a77-b4f4-1f9ff22e1182",
        model: "product.template",
        name: "A-TOPIC GEL",
        price: "20.75",
        sale_ok: true,
        tax_ids: [1],
        write_date: "2026-08-08T11:40:28Z",
      },
      variants: [
        {
          active: true,
          attribute_values: [],
          barcode: "8412345678901",
          default_code: "ATOPIC-001",
          id: 823,
          integration_key: "5aa969c0-8eb2-4a68-a093-8e0f9bd66f52",
          model: "product.product",
          name: "A-TOPIC GEL",
          price: "20.75",
          sale_ok: true,
          write_date: "2026-08-08T11:40:28Z",
        },
      ],
    },
  ],
  next_cursor: null,
} as const;

const catalog = {
  contractVersion: "mze.odoo.catalog.v1",
  items: [
    {
      template: {
        active: true,
        currency: "EUR",
        description: null,
        id: 352,
        integrationKey: "3f8c5e48-4aa9-4a77-b4f4-1f9ff22e1182",
        model: "product.template",
        name: "A-TOPIC GEL",
        price: "20.75",
        saleOk: true,
        taxIds: [1],
        writeDate: "2026-08-08T11:40:28Z",
      },
      variants: [
        {
          active: true,
          attributeValues: [],
          barcode: "8412345678901",
          id: 823,
          integrationKey: "5aa969c0-8eb2-4a68-a093-8e0f9bd66f52",
          internalReference: "ATOPIC-001",
          model: "product.product",
          name: "A-TOPIC GEL",
          price: "20.75",
          saleOk: true,
          writeDate: "2026-08-08T11:40:28Z",
        },
      ],
    },
  ],
  nextCursor: null,
} as const satisfies CatalogBatch;

type JsonValue =
  | boolean
  | null
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

function response<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function requestQueue(responses: ReadonlyArray<Response>) {
  const calls: Array<Request> = [];
  const remaining = [...responses];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push(new Request(input, init));
    const next = remaining.shift();
    if (next === undefined) throw new Error("Unexpected Odoo request");
    return next;
  };
  return { calls, fetch };
}

function documentationIndexResponse(): Response {
  return response({
    models: [{ methods: [ODOO_BRIDGE_METHOD], model: ODOO_BRIDGE_MODEL }],
    modules: ["api_doc", ODOO_BRIDGE_MODULE],
  });
}

function contractResponses(fixture: JsonValue = catalogWire): Array<Response> {
  return [
    documentationIndexResponse(),
    response({
      methods: { [ODOO_BRIDGE_METHOD]: { api: ["model", "readonly"] } },
      model: ODOO_BRIDGE_MODEL,
    }),
    response(fixture),
  ];
}

function bridge(
  overrides: Partial<Options> = {},
  responses: ReadonlyArray<Response> = contractResponses(),
) {
  const queued = requestQueue(responses);
  return {
    client: Result.getOrThrow(createOdooBridge({ ...options, ...overrides, fetch: queued.fetch })),
    queued,
  };
}

describe("Bridge Contract codecs", () => {
  it("decodes Odoo keys and encodes the exact Bridge Contract", async () => {
    const decoded = await Schema.decodeUnknownPromise(CatalogBatchSchema)(catalogWire);
    expect(decoded).toEqual(catalog);
    await expect(Schema.encodePromise(CatalogBatchSchema)(decoded)).resolves.toEqual(catalogWire);
  });
});

describe("Odoo bridge client", () => {
  it("composes as a native Effect service and layer", async () => {
    const queued = requestQueue([response(catalogWire)]);
    const bridgeLayer = OdooBridge.layer({
      apiKey: Redacted.make(options.apiKey),
      baseUrl: options.baseUrl,
      database: options.database,
    }).pipe(Layer.provide(FetchHttpClient.layer));
    const program = OdooBridge.readCatalogBatch({ limit: 1 }).pipe(
      Effect.provide(bridgeLayer),
      Effect.provideService(FetchHttpClient.Fetch, queued.fetch),
    );

    await expect(Effect.runPromise(program)).resolves.toEqual(catalog);
    expect(queued.calls).toHaveLength(1);
  });

  it("supports direct tagged-error recovery in the native API", async () => {
    const queued = requestQueue([]);
    const bridgeLayer = OdooBridge.layer({
      apiKey: Redacted.make(options.apiKey),
      baseUrl: options.baseUrl,
      database: options.database,
    }).pipe(Layer.provide(FetchHttpClient.layer));
    const program = OdooBridge.readCatalogBatch({ limit: 101 }).pipe(
      Effect.catchTag("InvalidCatalogBatchInput", () => Effect.succeed(catalog)),
      Effect.provide(bridgeLayer),
      Effect.provideService(FetchHttpClient.Fetch, queued.fetch),
    );

    await expect(Effect.runPromise(program)).resolves.toEqual(catalog);
    expect(queued.calls).toHaveLength(0);
  });

  it.each([
    { expectedTag: "InvalidApiKey", overrides: { apiKey: "" } },
    { expectedTag: "InvalidDatabase", overrides: { database: "" } },
    { expectedTag: "InvalidRequestTimeout", overrides: { requestTimeoutMs: 0 } },
  ])("validates client options as $expectedTag", ({ expectedTag, overrides }) => {
    expect(createOdooBridge({ ...options, ...overrides })).toMatchObject({
      _tag: "Failure",
      failure: { _tag: expectedTag },
    });
  });

  it("rejects a public hostname before it makes a request", async () => {
    const queued = requestQueue([]);
    const created = createOdooBridge({
      ...options,
      baseUrl: "https://clientes.mizonaecologica.es",
      fetch: queued.fetch,
    });

    expect(created).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PrivateOdooRouteRequired" },
    });
    expect(queued.calls).toHaveLength(0);
  });

  it("checks the documented method and returns a normalized fixture", async () => {
    const { client, queued } = bridge();
    await using disposable = client;

    const checked = Result.getOrThrow(await disposable.checkContract());
    expect(checked).toEqual({
      contractVersion: "mze.odoo.catalog.v1",
      fixture: catalog,
      method: ODOO_BRIDGE_METHOD,
      model: ODOO_BRIDGE_MODEL,
    });
    expect(queued.calls.map((call) => call.url)).toEqual([
      "https://odoo.eden.mizonaecologica.es/doc-bearer/index.json",
      `https://odoo.eden.mizonaecologica.es/doc-bearer/${ODOO_BRIDGE_MODEL}.json`,
      `https://odoo.eden.mizonaecologica.es/json/2/${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`,
    ]);
  });

  it("reads one Catalog Batch without a documentation request", async () => {
    const { client, queued } = bridge({}, [response(catalogWire)]);
    await using disposable = client;

    expect(Result.getOrThrow(await disposable.readCatalogBatch({ limit: 1 }))).toEqual(catalog);
    expect(queued.calls).toHaveLength(1);
    expect(queued.calls[0]?.method).toBe("POST");
    expect(queued.calls[0]?.headers.get("authorization")).toBe("Bearer odoo-test-api-key");
    expect(queued.calls[0]?.headers.get("x-odoo-database")).toBe("odoo");
    await expect(queued.calls[0]?.json()).resolves.toEqual({ cursor: null, limit: 1 });
  });

  it("uses one managed client for repeated calls", async () => {
    const { client, queued } = bridge({}, [response(catalogWire), response(catalogWire)]);
    await using disposable = client;

    Result.getOrThrow(await disposable.readCatalogBatch());
    Result.getOrThrow(await disposable.readCatalogBatch());

    expect(queued.calls).toHaveLength(2);
    await expect(queued.calls[0]?.json()).resolves.toEqual({ cursor: null, limit: 100 });
    await expect(queued.calls[1]?.json()).resolves.toEqual({ cursor: null, limit: 100 });
  });

  it("rejects an invalid Catalog Batch input before it makes a request", async () => {
    const { client, queued } = bridge({}, []);
    await using disposable = client;

    await expect(disposable.readCatalogBatch({ limit: 101 })).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: "InvalidCatalogBatchInput" },
    });
    expect(queued.calls).toHaveLength(0);
  });

  it("requires the bridge module", async () => {
    const { client } = bridge({}, [
      response({
        models: [{ methods: [ODOO_BRIDGE_METHOD], model: ODOO_BRIDGE_MODEL }],
        modules: ["api_doc"],
      }),
    ]);
    await using disposable = client;

    await expect(disposable.checkContract()).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: "BridgeContractMissing", part: "module" },
    });
  });

  it.each([
    { api: ["readonly"], code: "BridgeContractNotModel" },
    { api: ["model"], code: "BridgeContractNotReadonly" },
  ])("rejects an invalid method marker: $code", async ({ api, code }) => {
    const { client } = bridge({}, [
      documentationIndexResponse(),
      response({
        methods: { [ODOO_BRIDGE_METHOD]: { api } },
        model: ODOO_BRIDGE_MODEL,
      }),
    ]);
    await using disposable = client;

    await expect(disposable.checkContract()).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: code },
    });
  });

  it("rejects an empty catalog fixture", async () => {
    const { client } = bridge({}, [
      ...contractResponses({
        contract_version: "mze.odoo.catalog.v1",
        items: [],
        next_cursor: null,
      }),
    ]);
    await using disposable = client;

    await expect(disposable.checkContract()).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CatalogFixtureEmpty" },
    });
  });

  it.each([
    { code: "AuthenticationFailed", status: 401 },
    { code: "PermissionDenied", status: 403 },
    { code: "UnexpectedStatus", status: 503 },
  ])("classifies HTTP $status as $code", async ({ code, status }) => {
    const { client, queued } = bridge({}, [response({}, status), response(catalogWire)]);
    await using disposable = client;

    await expect(disposable.readCatalogBatch()).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: code },
    });
    expect(queued.calls).toHaveLength(1);
  });

  it("rejects a response that does not match the Bridge Contract", async () => {
    const { client } = bridge({}, [response({ items: [] })]);
    await using disposable = client;

    await expect(disposable.readCatalogBatch()).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: "InvalidCatalogBatchResponse" },
    });
  });

  it("does not include the API key in a transport error", async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new Error(`request failed for ${options.apiKey}`);
    };
    const client = Result.getOrThrow(createOdooBridge({ ...options, fetch }));
    await using disposable = client;

    const result = await disposable.readCatalogBatch();
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "TransportFailed" },
    });
    expect(JSON.stringify(result)).not.toContain(options.apiKey);
    expect(String(result)).not.toContain(options.apiKey);
  });

  it("rejects the Promise when the Effect dies with a defect", async () => {
    const defect = new Error("broken Response implementation");
    const invalidResponse = new Proxy(new Response(), {
      get(target, property, receiver) {
        if (property === "status") throw defect;
        return Reflect.get(target, property, receiver);
      },
    });
    const fetch: typeof globalThis.fetch = async () => invalidResponse;
    const client = Result.getOrThrow(createOdooBridge({ ...options, fetch }));
    await using disposable = client;

    await expect(disposable.readCatalogBatch()).rejects.toBe(defect);
  });

  it("interrupts an active request with the caller signal", async () => {
    let requestSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetch: typeof globalThis.fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal ?? undefined;
        markStarted?.();
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
          once: true,
        });
      });
    const client = Result.getOrThrow(createOdooBridge({ ...options, fetch }));
    await using disposable = client;
    const controller = new AbortController();
    const pending = disposable.readCatalogBatch({ signal: controller.signal });
    await started;

    controller.abort();

    await expect(pending).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: "OdooBridgeCallAborted" },
    });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("maps a request timeout to a bridge error", async () => {
    const fetch: typeof globalThis.fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    const client = Result.getOrThrow(createOdooBridge({ ...options, fetch, requestTimeoutMs: 1 }));
    await using disposable = client;

    await expect(disposable.readCatalogBatch()).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: "RequestTimedOut" },
    });
  });

  it("keeps the request timeout active while it reads the response body", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        headers: { "Content-Type": "application/json" },
      });
    const client = Result.getOrThrow(createOdooBridge({ ...options, fetch, requestTimeoutMs: 1 }));
    await using disposable = client;

    await expect(disposable.readCatalogBatch()).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: "RequestTimedOut" },
    });
  });

  it("interrupts active calls and rejects new calls after close", async () => {
    let requestSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetch: typeof globalThis.fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal ?? undefined;
        markStarted?.();
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
          once: true,
        });
      });
    const client = Result.getOrThrow(createOdooBridge({ ...options, fetch }));
    const pending = client.readCatalogBatch();
    await started;

    await client.close();

    await expect(pending).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: "OdooBridgeClientClosed" },
    });
    await expect(client.readCatalogBatch()).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: "OdooBridgeClientClosed" },
    });
    expect(requestSignal?.aborted).toBe(true);
    await expect(client.close()).resolves.toBeUndefined();
  });
});
