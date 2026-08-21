# `@mze-store/odoo-bridge`

This package reads the reviewed Odoo Bridge Contract through the Private Odoo
Route. It has a Result client for Medusa and a native Effect service.

## Result client

```ts
import { Result, createOdooBridge } from "@mze-store/odoo-bridge";

const created = createOdooBridge({
  apiKey: ENV.ODOO_API_KEY,
  baseUrl: ENV.ODOO_BASE_URL,
  database: ENV.ODOO_DATABASE,
});

if (Result.isFailure(created)) {
  console.error(created.failure.message);
  return;
}

await using bridge = created.success;
const read = await bridge.readCatalogBatch({ limit: 100 });

if (Result.isFailure(read)) {
  console.error(`${read.failure._tag}: ${read.failure.message}`);
  return;
}

useCatalogBatch(read.success);
```

`createOdooBridge` accepts:

| Option             | Type                      | Meaning                                                                                           |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `apiKey`           | `string`                  | Dedicated Odoo Service User API key.                                                              |
| `baseUrl`          | `string`                  | Allowed Private Odoo Route origin. Paths, credentials, queries, and fragments are rejected.       |
| `database`         | `string`                  | Odoo database sent in `X-Odoo-Database`.                                                          |
| `requestTimeoutMs` | `number`                  | Optional positive timeout for the full request and response-body read. The default is 20 seconds. |
| `fetch`            | `typeof globalThis.fetch` | Optional transport. The default is `globalThis.fetch`.                                            |

The asynchronous client has three methods:

- `checkContract({ signal? })` checks the documentation index, model method,
  read-only marker, and one catalog fixture.
- `readCatalogBatch({ cursor?, limit?, signal? })` reads one batch. `limit`
  defaults to 100 and must be from 1 through 100.
- `close()` interrupts active calls and releases the managed runtime. It is
  idempotent. `await using` calls it automatically.

Expected failures fulfill with `Result.Failure`. Use `Result.isFailure`, then
narrow `failure._tag`. Caller cancellation returns `OdooBridgeCallAborted`.
Runtime closure returns `OdooBridgeClientClosed`. Unknown implementation
defects reject the Promise.

## Native Effect service

```ts
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { OdooBridge } from "@mze-store/odoo-bridge/effect";

const OdooBridgeLive = OdooBridge.layer({
  apiKey: Redacted.make(ENV.ODOO_API_KEY),
  baseUrl: ENV.ODOO_BASE_URL,
  database: ENV.ODOO_DATABASE,
}).pipe(Layer.provide(FetchHttpClient.layer));

const program = OdooBridge.readCatalogBatch({ limit: 100 }).pipe(
  Effect.catchTag("AuthenticationFailed", (error) =>
    Effect.logError(error.message).pipe(Effect.andThen(Effect.fail(error))),
  ),
  Effect.provide(OdooBridgeLive),
);
```

The Effect service uses direct schema-backed tagged failures and exact error
unions. It does not convert interruption into client boundary errors.

The `/contract` entry exports the Effect Schema codecs for wire encoding and
decoding. The package does not expose generic Odoo RPC.
