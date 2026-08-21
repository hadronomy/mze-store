import { Duration, Redacted, Result, Schema } from "effect";

import {
  InvalidApiKey,
  InvalidDatabase,
  InvalidRequestTimeout,
  PrivateOdooRouteRequired,
  type ConfigurationError,
} from "~/error";

const PRIVATE_ODOO_ROUTES = new Set([
  "https://odoo.eden.mizonaecologica.es",
  "http://odoo.odoo.svc.cluster.local:8069",
]);

export interface Options {
  readonly apiKey: Redacted.Redacted<string>;
  readonly baseUrl: string;
  readonly database: string;
  readonly requestTimeout?: Duration.Input | undefined;
}

export interface Settings {
  readonly apiKey: Redacted.Redacted<string>;
  readonly baseUrl: string;
  readonly database: string;
  readonly requestTimeout: Duration.Duration;
}

export function decodeSettings(options: Options): Result.Result<Settings, ConfigurationError> {
  return Result.gen(function* () {
    if (
      !Redacted.isRedacted(options.apiKey) ||
      Redacted.value(options.apiKey).trim().length === 0
    ) {
      return yield* Result.fail(new InvalidApiKey({}));
    }
    if (options.database.trim().length === 0) {
      return yield* Result.fail(new InvalidDatabase({}));
    }

    const url = yield* Schema.decodeUnknownResult(Schema.URLFromString)(options.baseUrl).pipe(
      Result.mapError(() => new PrivateOdooRouteRequired({})),
    );
    if (!isPrivateOdooRoute(url)) {
      return yield* Result.fail(new PrivateOdooRouteRequired({}));
    }

    const requestTimeout = yield* Duration.fromInput(options.requestTimeout ?? "20 seconds").pipe(
      Result.fromOption(() => new InvalidRequestTimeout({})),
    );
    if (!Duration.isFinite(requestTimeout) || !Duration.isPositive(requestTimeout)) {
      return yield* Result.fail(new InvalidRequestTimeout({}));
    }

    return {
      apiKey: options.apiKey,
      baseUrl: url.origin,
      database: options.database,
      requestTimeout,
    };
  });
}

function isPrivateOdooRoute(url: URL): boolean {
  return (
    PRIVATE_ODOO_ROUTES.has(url.origin) &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
}
