import { describe, expect, it } from "vite-plus/test";
import {
  ODOO_BRIDGE_METHOD,
  ODOO_BRIDGE_MODEL,
  OdooBridgeClient,
  OdooBridgeError,
  isPrivateOdooEndpoint,
  type OdooRequest,
} from "~/index";

const config = {
  apiKey: "odoo-test-api-key",
  baseUrl: "https://odoo.eden.mizonaecologica.es",
  database: "odoo",
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

describe("OdooBridgeClient", () => {
  it("allows only the known private Odoo endpoints", () => {
    expect(isPrivateOdooEndpoint("https://odoo.eden.mizonaecologica.es")).toBe(true);
    expect(isPrivateOdooEndpoint("http://odoo.odoo.svc.cluster.local:8069")).toBe(true);
    expect(isPrivateOdooEndpoint("https://other.odoo.svc.cluster.local")).toBe(false);
    expect(isPrivateOdooEndpoint("https://odoo.eden.mizonaecologica.es:8443")).toBe(false);
  });

  it("sends the private JSON-2 request and decodes a catalog batch", async () => {
    const queued = requestQueue([response(catalog)]);
    const client = new OdooBridgeClient(config, queued.request);

    await expect(client.readCatalogBatch({ limit: 1 })).resolves.toEqual(catalog);

    expect(queued.calls).toHaveLength(1);
    expect(queued.calls[0]?.url).toBe(
      `https://odoo.eden.mizonaecologica.es/json/2/${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`,
    );
    expect(queued.calls[0]?.method).toBe("POST");
    expect(queued.calls[0]?.headers.get("authorization")).toBe("bearer odoo-test-api-key");
    expect(queued.calls[0]?.headers.get("x-odoo-database")).toBe("odoo");
    await expect(queued.calls[0]?.json()).resolves.toEqual({ limit: 1, cursor: null });
  });

  it("rejects a public customer hostname before making a request", () => {
    expect(
      () =>
        new OdooBridgeClient({
          ...config,
          baseUrl: "https://clientes.mizonaecologica.es",
        }),
    ).toThrowError(
      expect.objectContaining<Partial<OdooBridgeError>>({ code: "private_endpoint_required" }),
    );
  });

  it("rejects a private hostname with an unapproved port", () => {
    expect(
      () =>
        new OdooBridgeClient({
          ...config,
          baseUrl: "https://odoo.eden.mizonaecologica.es:8443",
        }),
    ).toThrowError(
      expect.objectContaining<Partial<OdooBridgeError>>({ code: "private_endpoint_required" }),
    );
  });

  it("rejects credentials embedded in the private URL", () => {
    expect(
      () =>
        new OdooBridgeClient({
          ...config,
          baseUrl: "https://admin:password@odoo.eden.mizonaecologica.es",
        }),
    ).toThrowError(
      expect.objectContaining<Partial<OdooBridgeError>>({ code: "private_endpoint_required" }),
    );
  });

  it("reports a missing bridge method as a rollout blocker", async () => {
    const queued = requestQueue([
      response({
        models: [{ model: ODOO_BRIDGE_MODEL, methods: [] }],
        modules: ["api_doc"],
      }),
      response({ model: ODOO_BRIDGE_MODEL, methods: {} }),
    ]);
    const client = new OdooBridgeClient(config, queued.request);

    await expect(client.checkReadOnlyContract()).rejects.toMatchObject({
      code: "bridge_method_missing",
    });
    expect(queued.calls).toHaveLength(2);
  });

  it("checks documentation before reading the normalized fixture", async () => {
    const queued = requestQueue([
      response({
        models: [{ model: ODOO_BRIDGE_MODEL, methods: [ODOO_BRIDGE_METHOD] }],
        modules: ["api_doc", "mze_medusa_bridge"],
      }),
      response({
        model: ODOO_BRIDGE_MODEL,
        methods: { [ODOO_BRIDGE_METHOD]: { api: ["model", "readonly"] } },
      }),
      response(catalog),
    ]);
    const client = new OdooBridgeClient(config, queued.request);

    await expect(client.checkReadOnlyContract()).resolves.toMatchObject({
      catalog,
      method: `${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`,
    });
    expect(queued.calls.map((call) => call.url)).toEqual([
      "https://odoo.eden.mizonaecologica.es/doc-bearer/index.json",
      `https://odoo.eden.mizonaecologica.es/doc-bearer/${ODOO_BRIDGE_MODEL}.json`,
      `https://odoo.eden.mizonaecologica.es/json/2/${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`,
    ]);
  });

  it("blocks a bridge method that is not marked read-only", async () => {
    const queued = requestQueue([
      response({
        models: [{ model: ODOO_BRIDGE_MODEL, methods: [ODOO_BRIDGE_METHOD] }],
        modules: ["api_doc", "mze_medusa_bridge"],
      }),
      response({
        model: ODOO_BRIDGE_MODEL,
        methods: { [ODOO_BRIDGE_METHOD]: { api: ["model"] } },
      }),
    ]);
    const client = new OdooBridgeClient(config, queued.request);

    await expect(client.checkReadOnlyContract()).rejects.toMatchObject({
      code: "bridge_method_not_readonly",
    });
    expect(queued.calls).toHaveLength(2);
  });

  it("blocks an empty catalog fixture", async () => {
    const queued = requestQueue([
      response({
        models: [{ model: ODOO_BRIDGE_MODEL, methods: [ODOO_BRIDGE_METHOD] }],
        modules: ["api_doc", "mze_medusa_bridge"],
      }),
      response({
        model: ODOO_BRIDGE_MODEL,
        methods: { [ODOO_BRIDGE_METHOD]: { api: ["model", "readonly"] } },
      }),
      response({ contract_version: "mze.odoo.catalog.v1", items: [], next_cursor: null }),
    ]);
    const client = new OdooBridgeClient(config, queued.request);

    await expect(client.checkReadOnlyContract()).rejects.toMatchObject({
      code: "catalog_fixture_missing",
    });
    expect(queued.calls).toHaveLength(3);
  });

  it("classifies authentication failures without exposing the API key", async () => {
    const queued = requestQueue([response({ message: "Invalid apikey" }, 401)]);
    const client = new OdooBridgeClient(config, queued.request);

    await expect(client.readDocumentationIndex()).rejects.toMatchObject({
      code: "documentation_unavailable",
      message: "Odoo documentation index request failed with HTTP 401.",
      status: 401,
    });
  });

  it("redacts the API key from transport errors", async () => {
    const request: OdooRequest = async () => {
      throw new Error(`request failed for ${config.apiKey}`);
    };
    const client = new OdooBridgeClient(config, request);

    await expect(client.readDocumentationIndex()).rejects.toMatchObject({
      code: "documentation_unavailable",
      message: "Odoo documentation index request failed. request failed for [redacted]",
    });
  });
});
