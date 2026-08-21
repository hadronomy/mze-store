import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import {
  CatalogBatchInputSchema,
  CatalogBatchRequestSchema,
  CatalogBatchSchema,
  ODOO_BRIDGE_METHOD,
  ODOO_BRIDGE_MODEL,
  type CatalogBatch,
  type CatalogBatchInput,
  type CatalogBatchRequest,
} from "~/contract";
import {
  InvalidCatalogBatchInput,
  InvalidCatalogBatchResponse,
  type ReadCatalogBatchError,
  type RequestError,
} from "~/error";
import { executeJson } from "./http-client";
import type { Settings } from "./options";

const CATALOG_BATCH_PATH = `/json/2/${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`;

export function readCatalogBatch(
  client: HttpClient.HttpClient,
  settings: Settings,
  input?: CatalogBatchInput,
): Effect.Effect<CatalogBatch, ReadCatalogBatchError> {
  return Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(CatalogBatchInputSchema)(input ?? {}).pipe(
      Effect.mapError(() => new InvalidCatalogBatchInput({})),
    );

    return yield* executeCatalogBatch(client, settings, {
      cursor: decoded.cursor ?? null,
      limit: decoded.limit ?? 100,
    });
  });
}

export function readCatalogFixture(
  client: HttpClient.HttpClient,
  settings: Settings,
): Effect.Effect<CatalogBatch, InvalidCatalogBatchResponse | RequestError> {
  return executeCatalogBatch(client, settings, { cursor: null, limit: 1 });
}

function executeCatalogBatch(
  client: HttpClient.HttpClient,
  settings: Settings,
  input: CatalogBatchRequest,
): Effect.Effect<CatalogBatch, InvalidCatalogBatchResponse | RequestError> {
  return Effect.gen(function* () {
    const request = yield* HttpClientRequest.schemaBodyJson(CatalogBatchRequestSchema)(
      HttpClientRequest.post(CATALOG_BATCH_PATH),
      input,
    ).pipe(Effect.orDie);

    return yield* executeJson(
      client,
      request,
      CatalogBatchSchema,
      () => new InvalidCatalogBatchResponse({}),
      settings.requestTimeout,
    );
  });
}
