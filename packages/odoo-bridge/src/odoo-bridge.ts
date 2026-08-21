import { Context, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

import type { BridgeContractCheck, CatalogBatch, CatalogBatchInput } from "./contract";
import type { CheckContractError, ConfigurationError, ReadCatalogBatchError } from "./error";
import { readCatalogBatch as readCatalogBatchRequest } from "~/internal/catalog";
import { checkContract as checkContractRequest } from "~/internal/contract-check";
import { configureHttpClient } from "~/internal/http-client";
import { decodeSettings, type Options as OdooBridgeOptions } from "~/internal/options";

export type Options = OdooBridgeOptions;

export interface Interface {
  readonly checkContract: () => Effect.Effect<BridgeContractCheck, CheckContractError>;
  readonly readCatalogBatch: (
    input?: CatalogBatchInput,
  ) => Effect.Effect<CatalogBatch, ReadCatalogBatchError>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@mze-store/odoo-bridge/OdooBridge",
) {}

export const make = Effect.fn("OdooBridge.make")(function* (options: Options) {
  const settings = yield* Effect.fromResult(decodeSettings(options));
  const client = configureHttpClient(yield* HttpClient.HttpClient, settings);

  const readCatalogBatch = Effect.fn("OdooBridge.readCatalogBatch")(function* (
    input?: CatalogBatchInput,
  ) {
    return yield* readCatalogBatchRequest(client, settings, input);
  });

  const checkContract = Effect.fn("OdooBridge.checkContract")(function* () {
    return yield* checkContractRequest(client, settings);
  });

  return Service.of({ checkContract, readCatalogBatch });
});

export const layer = (
  options: Options,
): Layer.Layer<Service, ConfigurationError, HttpClient.HttpClient> =>
  Layer.effect(Service, make(options));

export const checkContract: Effect.Effect<BridgeContractCheck, CheckContractError, Service> =
  Service.use((bridge) => bridge.checkContract());

export const readCatalogBatch = (
  input?: CatalogBatchInput,
): Effect.Effect<CatalogBatch, ReadCatalogBatchError, Service> =>
  Service.use((bridge) => bridge.readCatalogBatch(input));

export * as OdooBridge from "./odoo-bridge";
