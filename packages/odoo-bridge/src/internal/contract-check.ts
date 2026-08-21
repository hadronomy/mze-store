import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import {
  ODOO_BRIDGE_METHOD,
  ODOO_BRIDGE_MODEL,
  ODOO_BRIDGE_MODULE,
  ODOO_CATALOG_CONTRACT_VERSION,
  type BridgeContractCheck,
} from "~/contract";
import {
  BridgeContractMissing,
  BridgeContractNotModel,
  BridgeContractNotReadonly,
  CatalogFixtureEmpty,
  InvalidDocumentationIndexResponse,
  InvalidModelDocumentationResponse,
  type CheckContractError,
} from "~/error";
import { readCatalogFixture } from "./catalog";
import { DocumentationIndexSchema, ModelDocumentationSchema } from "./documentation";
import { executeJson } from "./http-client";
import type { Settings } from "./options";

export function checkContract(
  client: HttpClient.HttpClient,
  settings: Settings,
): Effect.Effect<BridgeContractCheck, CheckContractError> {
  return Effect.gen(function* () {
    const index = yield* executeJson(
      client,
      HttpClientRequest.get("/doc-bearer/index.json"),
      DocumentationIndexSchema,
      () => new InvalidDocumentationIndexResponse({}),
      settings.requestTimeout,
    );

    if (!index.modules.includes(ODOO_BRIDGE_MODULE)) {
      return yield* new BridgeContractMissing({ part: "module" });
    }

    const documentedModel = index.models.find(({ model }) => model === ODOO_BRIDGE_MODEL);
    if (documentedModel === undefined) {
      return yield* new BridgeContractMissing({ part: "model" });
    }
    if (!documentedModel.methods.includes(ODOO_BRIDGE_METHOD)) {
      return yield* new BridgeContractMissing({ part: "method" });
    }

    const model = yield* executeJson(
      client,
      HttpClientRequest.get(`/doc-bearer/${encodeURIComponent(ODOO_BRIDGE_MODEL)}.json`),
      ModelDocumentationSchema,
      () => new InvalidModelDocumentationResponse({}),
      settings.requestTimeout,
    );

    if (model.model !== ODOO_BRIDGE_MODEL) {
      return yield* new BridgeContractMissing({ part: "model" });
    }

    const method = model.methods[ODOO_BRIDGE_METHOD];
    if (method === undefined) {
      return yield* new BridgeContractMissing({ part: "method" });
    }
    if (method.api === undefined || !method.api.includes("model")) {
      return yield* new BridgeContractNotModel({});
    }
    if (!method.api.includes("readonly")) {
      return yield* new BridgeContractNotReadonly({});
    }

    const fixture = yield* readCatalogFixture(client, settings);
    if (fixture.items.length === 0) {
      return yield* new CatalogFixtureEmpty({});
    }

    return {
      contractVersion: ODOO_CATALOG_CONTRACT_VERSION,
      fixture,
      method: ODOO_BRIDGE_METHOD,
      model: ODOO_BRIDGE_MODEL,
    };
  });
}
