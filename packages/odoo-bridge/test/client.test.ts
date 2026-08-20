import { describe, expect, it } from "vite-plus/test";

import {
  ODOO_BRIDGE_METHOD,
  ODOO_BRIDGE_MODEL,
  OdooBridgeError,
  isPrivateOdooEndpoint,
} from "~/index";
import { createPromiseBridge, type OdooPromiseBridgeOptions } from "~/promise";
import type { OdooRequest } from "~/effect";
import type { OdooCatalogBatch } from "~/contract";

const config = {
  apiKey: "odoo-test-api-key",
  baseUrl: "https://odoo.eden.mizonaecologica.es",
  database: "odoo",
} as const;

const cursor = {
  id: 824,
  write_date: "2026-08-08T11:40:28Z",
} as const;

const catalog = {
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

function response<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function requestQueue(responses: Response[]) {
  const calls: Request[] = [];
  const request: OdooRequest = async (input, init) => {
    calls.push(new Request(input, init));
    const next = responses.shift();
    if (!next) throw new Error("Unexpected Odoo request");
    return next;
  };
  return { calls, request };
}

function verifiedResponses(fixture: OdooCatalogBatch = catalog): Response[] {
  return [
    response({
      models: [{ model: ODOO_BRIDGE_MODEL, methods: [ODOO_BRIDGE_METHOD] }],
      modules: ["api_doc", "mze_medusa_bridge"],
    }),
    response({
      model: ODOO_BRIDGE_MODEL,
      methods: { [ODOO_BRIDGE_METHOD]: { api: ["model", "readonly"] } },
    }),
    response(fixture),
  ];
}

function bridge(
  options: Partial<OdooPromiseBridgeOptions> = {},
  responses: Response[] = verifiedResponses(),
) {
  const queued = requestQueue(responses);
  return {
    client: createPromiseBridge({ ...config, ...options, request: queued.request }),
    queued,
  };
}

describe("Promise bridge", () => {
  it("allows only the known private Odoo endpoints", () => {
    expect(isPrivateOdooEndpoint("https://odoo.eden.mizonaecologica.es")).toBe(true);
    expect(isPrivateOdooEndpoint("http://odoo.odoo.svc.cluster.local:8069")).toBe(true);
    expect(isPrivateOdooEndpoint("https://other.odoo.svc.cluster.local")).toBe(false);
    expect(isPrivateOdooEndpoint("https://odoo.eden.mizonaecologica.es:8443")).toBe(false);
  });

  it("rejects a public customer hostname before making a request", () => {
    expect(() =>
      createPromiseBridge({ ...config, baseUrl: "https://clientes.mizonaecologica.es" }),
    ).toThrowError(
      expect.objectContaining<Partial<OdooBridgeError>>({ code: "private_endpoint_required" }),
    );
  });

  it("checks documentation before reading the normalized catalog", async () => {
    const { client, queued } = bridge();

    await expect(client.verify()).resolves.toMatchObject({
      catalog,
      method: `${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`,
    });
    expect(queued.calls.map((call) => call.url)).toEqual([
      "https://odoo.eden.mizonaecologica.es/doc-bearer/index.json",
      `https://odoo.eden.mizonaecologica.es/doc-bearer/${ODOO_BRIDGE_MODEL}.json`,
      `https://odoo.eden.mizonaecologica.es/json/2/${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`,
    ]);
  });

  it("injects AbortSignal and sends the JSON-2 headers", async () => {
    const { client, queued } = bridge({}, [...verifiedResponses(), response(catalog)]);
    const controller = new AbortController();

    await expect(
      client.readCatalogBatch({ limit: 1 }, { signal: controller.signal }),
    ).resolves.toEqual(catalog);
    expect(queued.calls).toHaveLength(4);
    expect(queued.calls[3]?.method).toBe("POST");
    expect(queued.calls[3]?.headers.get("authorization")).toBe("bearer odoo-test-api-key");
    expect(queued.calls[3]?.headers.get("x-odoo-database")).toBe("odoo");
    await expect(queued.calls[3]?.json()).resolves.toEqual({ limit: 1, cursor: null });
  });

  it("reuses the verified fixture as the first page and follows cursors", async () => {
    const firstPage = { ...catalog, next_cursor: cursor };
    const secondPage = { ...catalog, items: [], next_cursor: null };
    const { client, queued } = bridge({}, [...verifiedResponses(firstPage), response(secondPage)]);

    const pages = [];
    for await (const page of client.readCatalogPages({ pageSize: 100 })) pages.push(page);

    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ requestCursor: null, sequence: 1, batch: firstPage });
    expect(pages[1]).toMatchObject({ requestCursor: cursor, sequence: 2, batch: secondPage });
    expect(queued.calls).toHaveLength(4);
    await expect(queued.calls[3]?.json()).resolves.toEqual({ limit: 100, cursor });
  });

  it("blocks a bridge method that is not marked read-only", async () => {
    const responses = [
      response({
        models: [{ model: ODOO_BRIDGE_MODEL, methods: [ODOO_BRIDGE_METHOD] }],
        modules: ["api_doc"],
      }),
      response({ model: ODOO_BRIDGE_MODEL, methods: { [ODOO_BRIDGE_METHOD]: { api: ["model"] } } }),
    ];
    const { client, queued } = bridge({ maxAttempts: 1 }, responses);

    await expect(client.verify()).rejects.toMatchObject({ code: "bridge_method_not_readonly" });
    expect(queued.calls).toHaveLength(2);
  });

  it("blocks an empty catalog fixture", async () => {
    const { client, queued } = bridge(
      { maxAttempts: 1 },
      verifiedResponses({ contract_version: "mze.odoo.catalog.v1", items: [], next_cursor: null }),
    );

    await expect(client.verify()).rejects.toMatchObject({ code: "catalog_fixture_missing" });
    expect(queued.calls).toHaveLength(3);
  });

  it("redacts the API key from transport errors", async () => {
    const request: OdooRequest = async () => {
      throw new Error(`request failed for ${config.apiKey}`);
    };
    const client = createPromiseBridge({ ...config, maxAttempts: 1, request });

    await expect(client.verify()).rejects.toMatchObject({
      code: "documentation_unavailable",
      message: "Odoo documentation.index request failed. request failed for [redacted]",
    });
  });

  it("retries transient HTTP failures within the configured bound", async () => {
    const { client, queued } = bridge({ maxAttempts: 3 }, [
      response({}, 503),
      response({}, 503),
      ...verifiedResponses(),
    ]);

    await expect(client.verify()).resolves.toMatchObject({
      method: `${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`,
    });
    expect(queued.calls).toHaveLength(5);
  });

  it("converts a request timeout to a typed bridge error", async () => {
    const request: OdooRequest = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          {
            once: true,
          },
        );
      });
    const client = createPromiseBridge({
      ...config,
      maxAttempts: 1,
      requestTimeoutMs: 10,
      request,
    });

    await expect(client.verify()).rejects.toMatchObject({ code: "timeout" });
  });

  it("stops a request when the caller aborts", async () => {
    const controller = new AbortController();
    const request: OdooRequest = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          {
            once: true,
          },
        );
      });
    const client = createPromiseBridge({ ...config, maxAttempts: 1, request });
    const pending = client.verify({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("aborts the active catalog iterator when its total timeout expires", async () => {
    const signals: AbortSignal[] = [];
    const request: OdooRequest = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        if (!signal) return;
        signals.push(signal);
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      });
    const client = createPromiseBridge({ ...config, maxAttempts: 1, request });
    const iterator = client.readCatalogPages({ timeoutMs: 10 })[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toMatchObject({ code: "timeout" });
    expect(signals[0]?.aborted).toBe(true);
  });
});
