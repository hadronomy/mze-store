import { Effect, flow, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  AuthenticationFailed,
  PermissionDenied,
  RequestTimedOut,
  TransportFailed,
  UnexpectedStatus,
  type InvalidResponseError,
  type RequestError,
} from "~/error";
import type { Settings } from "./options";

export function configureHttpClient(
  client: HttpClient.HttpClient,
  settings: Settings,
): HttpClient.HttpClient {
  return client.pipe(
    HttpClient.mapRequest(
      flow(
        HttpClientRequest.prependUrl(settings.baseUrl),
        HttpClientRequest.bearerToken(settings.apiKey),
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeader("Cache-Control", "no-cache"),
        HttpClientRequest.setHeader("User-Agent", "mze-store/odoo-bridge"),
        HttpClientRequest.setHeader("X-Odoo-Database", settings.database),
      ),
    ),
  );
}

export function executeJson<
  S extends Schema.Constraint & { readonly DecodingServices: never },
  E extends InvalidResponseError,
>(
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  responseSchema: S,
  onInvalidResponse: () => E,
  requestTimeout: Settings["requestTimeout"],
): Effect.Effect<S["Type"], E | RequestError> {
  return Effect.gen(function* () {
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError(() => new TransportFailed({})));

    if (response.status < 200 || response.status >= 300) {
      return yield* statusError(response.status);
    }

    return yield* HttpClientResponse.schemaBodyJson(responseSchema)(response).pipe(
      Effect.mapError(onInvalidResponse),
    );
  }).pipe(
    Effect.timeout(requestTimeout),
    Effect.catchTag("TimeoutError", () => new RequestTimedOut({})),
  );
}

function statusError(status: number): RequestError {
  if (status === 401) return new AuthenticationFailed({ status });
  if (status === 403) return new PermissionDenied({ status });
  return new UnexpectedStatus({ status });
}
