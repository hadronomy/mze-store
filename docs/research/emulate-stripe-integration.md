# Emulate for Medusa Stripe integration tests

Date: 2026-08-05

## Decision

Add Emulate only to the Medusa integration-test suite and CI. A local developer does not need Emulate to run the store.

The first test covers one result. Medusa creates a Stripe Payment Intent, and the test reads the same intent from Emulate.

Do not use Emulate in staging or production. Do not add it to Compose, the production image command, or application configuration.

Keep these operations outside this change:

- Payment Intent confirmation through Stripe.js.
- Payment capture.
- Refunds.
- Saved payment methods.
- The complete Stripe webhook lifecycle.
- A full Shopper checkout.

Emulate does not implement enough Stripe behavior for those operations. Real Stripe test mode must cover them in a later acceptance-test layer.

## Ownership and current status

Emulate is an Apache-2.0 project in the Vercel Labs GitHub organization. GitHub verifies that this organization controls `vercel.com`.

This evidence supports the description “a Vercel Labs project.” It does not make Emulate a hosted Vercel platform product. [Vercel Labs organization](https://github.com/vercel-labs), [Emulate repository](https://github.com/vercel-labs/emulate)

The current `emulate` and `@emulators/stripe` package files report version `0.9.0`. Pin this version in the Medusa development dependencies. [CLI package metadata](https://github.com/vercel-labs/emulate/blob/main/packages/emulate/package.json), [Stripe package metadata](https://github.com/vercel-labs/emulate/blob/main/packages/%40emulators/stripe/package.json)

The project is active, but its release surfaces do not agree. The latest GitHub Release is `v0.8.0`, while the home page example still prints `v0.4.1`.

Use package metadata and source as the current record. Do not infer behavior from the home-page version string. [GitHub Releases](https://github.com/vercel-labs/emulate/releases), [Emulate home page](https://emulate.dev/)

Emulate is still below version 1.0. Treat its API and seed format as unstable, and keep the exact version in `bun.lock`.

## Current branch

This branch uses Medusa `2.18.0`. It registers the official Stripe provider as `pp_stripe_stripe` for the Spain Region.

The relevant files are:

- [`apps/medusa/medusa-config.ts`](../../apps/medusa/medusa-config.ts)
- [`apps/medusa/src/payment/stripe.ts`](../../apps/medusa/src/payment/stripe.ts)
- [`apps/medusa/integration-tests/http/territory.spec.ts`](../../apps/medusa/integration-tests/http/territory.spec.ts)
- [`apps/medusa/integration-tests/http/stripe.spec.ts`](../../apps/medusa/integration-tests/http/stripe.spec.ts)
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
- [`apps/medusa/.env.test`](../../apps/medusa/.env.test)

Before this change, the territory test proved only that the Store API listed `pp_stripe_stripe`. It did not create a payment session or contact Stripe.

The branch uses dummy `sk_test_*` values in tests, CI, and the Docker build. The integration-test value reaches only local Emulate. The other values only let the provider initialize.

## Why a network bridge is necessary

Emulate is a local replacement API. It is not a forward proxy to Stripe.

The standalone Stripe service accepts the standard `/v1/*` paths. The official example points the Stripe SDK at a local host and port. [Stripe example client](https://github.com/vercel-labs/emulate/blob/main/examples/stripe-checkout/src/lib/stripe.ts), [Stripe routes](https://emulate.dev/docs/stripe)

Stripe Node `15.12.0` accepts `host`, `port`, and `protocol` in its constructor configuration. Its defaults are `api.stripe.com`, port `443`, and HTTPS. [Stripe Node configuration](https://github.com/stripe/stripe-node/blob/v15.12.0/README.md#configuration), [Stripe Node constructor source](https://github.com/stripe/stripe-node/blob/v15.12.0/src/stripe.core.ts)

The Medusa `2.18.0` Stripe provider creates its client with only `new Stripe(options.apiKey)`. Its public options do not include a host, port, protocol, or HTTP client. [Medusa provider source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/providers/payment-stripe/src/core/stripe-base.ts), [Medusa provider options](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/providers/payment-stripe/src/types/index.ts)

Therefore, Emulate cannot replace the Stripe host through `medusa-config.ts`. Do not patch or replace the official Medusa provider for this test.

Use Nock as a test-only network bridge. It intercepts the request for `https://api.stripe.com/v1/payment_intents` and forwards that request to Emulate.

Pin Nock to `13.5.6`. Nock issue `#2785` records that Stripe Node requests can hang under Nock 14's interception layer. The reporter confirmed that Nock 13 works, and a Nock maintainer confirmed the interception limit. `13.5.6` is the final Nock 13 patch release. [Nock Stripe issue](https://github.com/nock/nock/issues/2785), [Nock 13.5.6 release](https://github.com/nock/nock/releases/tag/v13.5.6)

Do not upgrade this pin until an isolated Stripe Node request consumes a Nock interceptor and returns. The focused integration test also protects this behavior.

The bridge must match only this method and path:

```text
POST https://api.stripe.com/v1/payment_intents
  -> POST <stripeEmulator.url>/v1/payment_intents
```

Forward the raw form body, `Authorization`, and `Content-Type`. Return the Emulate status, body, and content type to Stripe Node.

Do not use a wildcard bridge. An unsupported Stripe call must fail instead of reaching Stripe or receiving a false Emulate success.

Disable external HTTP access while the bridge is active. Permit only loopback HTTP because the Medusa test server and Emulate both use loopback addresses.

## Base URL behavior

When only Stripe starts, the CLI uses the selected base port for Stripe. The default selected base port is `4000`.

When all services start at their defaults, Stripe uses `4009`. Use `4009` explicitly so the test URL stays stable. [Getting started](https://emulate.dev/docs)

The test suite must start the service with this programmatic configuration:

```ts
createEmulator({ service: "stripe", port: 4009 });
```

The `--base-url` option changes URLs that Emulate advertises. Examples include hosted-checkout URLs, webhook URLs, and OAuth redirects.

The option does not redirect Stripe SDK traffic. The SDK still needs its own host configuration or the test-only bridge. [Programmatic API](https://emulate.dev/docs/programmatic-api), [base-URL resolution](https://github.com/vercel-labs/emulate/blob/main/packages/emulate/src/base-url.ts)

Emulate also supports `EMULATE_PORT`, `PORT`, `EMULATE_BASE_URL`, and a per-service `baseUrl`. This test needs none of them.

## Install and configuration

Add both packages to `apps/medusa` as development dependencies:

```sh
cd apps/medusa
bun add --dev --exact emulate@0.9.0 nock@13.5.6
```

Use the `emulate` package because it exports `createEmulator`. The scoped `@emulators/stripe` package exposes the lower-level service plugin. [Programmatic API](https://emulate.dev/docs/programmatic-api)

Do not add a production script or a GitHub Actions service. The Jest suite starts and closes Emulate in its process.

No seed file is necessary for the first test. The Payment Intent collection starts empty after Emulate applies its default seed.

For manual inspection only, a developer can run this command:

```sh
bunx emulate@0.9.0 --service stripe --port 4009
```

The CLI can auto-detect `emulate.config.yaml`, `emulate.config.yml`, or `emulate.config.json`. It also accepts `--seed` for another YAML or JSON file. [Emulate configuration](https://emulate.dev/docs/configuration)

If later tests add seed data, use the current source schema. The current price key is `product_name`, not `product`.

The current source does not accept the documented `recurring` price seed object. Source and public configuration examples currently disagree. [Stripe seed type](https://github.com/vercel-labs/emulate/blob/main/packages/%40emulators/stripe/src/index.ts), [public configuration](https://emulate.dev/docs/configuration)

## Supported Stripe operations

The following table compares Emulate `0.9.0` with calls from the Medusa `2.18.0` Stripe provider.

| Medusa action                      | Stripe route                            | Emulate          | Result for this project                   |
| ---------------------------------- | --------------------------------------- | ---------------- | ----------------------------------------- |
| Create a payment session           | `POST /v1/payment_intents`              | Supported        | In scope                                  |
| Read payment status                | `GET /v1/payment_intents/:id`           | Supported        | Direct Emulate readback is in scope       |
| Update a payment session           | `POST /v1/payment_intents/:id`          | Supported        | Not required by the first test            |
| Cancel or delete a payment session | `POST /v1/payment_intents/:id/cancel`   | Supported        | A possible later test                     |
| Confirm a Payment Intent           | `POST /v1/payment_intents/:id/confirm`  | Partly supported | Not compatible with Medusa manual capture |
| Capture a payment                  | `POST /v1/payment_intents/:id/capture`  | Not implemented  | Outside this change                       |
| Refund a payment                   | `POST /v1/refunds`                      | Not implemented  | Outside this change                       |
| List saved payment methods         | `GET /v1/customers/:id/payment_methods` | Not implemented  | Outside this change                       |
| Save a payment method              | `POST /v1/setup_intents`                | Not implemented  | Outside this change                       |
| Detach a payment method            | `POST /v1/payment_methods/:id/detach`   | Not implemented  | Outside this change                       |

Emulate also implements Customer, Charge, Product, Price, Customer Session, and Checkout Session routes. The Medusa Payment Intent flow does not use Checkout Sessions. [Emulate Stripe route list](https://emulate.dev/docs/stripe), [Emulate Stripe plugin](https://github.com/vercel-labs/emulate/blob/main/packages/%40emulators/stripe/src/index.ts)

The Medusa provider calls capture and refund routes after an Order exists. Its source also calls Setup Intent and saved-payment-method routes. [Medusa provider source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/providers/payment-stripe/src/core/stripe-base.ts)

Stripe defines capture at `POST /v1/payment_intents/:id/capture`. Stripe defines refund creation at `POST /v1/refunds`. [Stripe capture API](https://docs.stripe.com/api/payment_intents/capture), [Stripe refund API](https://docs.stripe.com/api/refunds/create)

## Important fidelity limits

Emulate accepts the Payment Intent create request, but it ignores important Stripe fields. These fields include `capture_method`, `automatic_payment_methods`, and `payment_method_configuration`.

The Emulate response omits `client_secret`, `amount_received`, and `amount_capturable`. Its formatter returns only a small Payment Intent shape. [Payment Intent routes](https://github.com/vercel-labs/emulate/blob/main/packages/%40emulators/stripe/src/routes/payment-intents.ts), [Payment Intent formatter](https://github.com/vercel-labs/emulate/blob/main/packages/%40emulators/stripe/src/formatters.ts)

Medusa uses manual capture by default. Stripe confirmation must then produce `requires_capture`, but Emulate always changes a confirmed intent to `succeeded`.

This difference makes capture tests invalid. It also prevents a faithful Order payment-status test. [Medusa Stripe options](https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider/stripe), [Stripe confirmation behavior](https://docs.stripe.com/api/payment_intents/confirm), [Emulate confirmation source](https://github.com/vercel-labs/emulate/blob/main/packages/%40emulators/stripe/src/routes/payment-intents.ts)

The Emulate repository does not contain a Stripe.js or Payment Element emulator. Its hosted page belongs to the Checkout Session route, which Medusa does not use.

Therefore, the first test must stop after Payment Intent creation. It must not present itself as a Shopper checkout test.

## Webhooks

Emulate can register webhook targets in seed configuration. Its Payment Intent routes dispatch created, succeeded, and canceled events.

The public Stripe page documents only the two Checkout Session events. Use source when you inspect the current event list. [Emulate Stripe docs](https://emulate.dev/docs/stripe), [Payment Intent event source](https://github.com/vercel-labs/emulate/blob/main/packages/%40emulators/stripe/src/routes/payment-intents.ts)

Emulate signs webhook payloads with `X-Hub-Signature-256`. Stripe uses `Stripe-Signature` with its own timestamped signature format. [Emulate webhook dispatcher](https://github.com/vercel-labs/emulate/blob/main/packages/%40emulators/core/src/webhooks.ts), [Stripe signature documentation](https://docs.stripe.com/webhooks/signature)

The Medusa provider reads `stripe-signature` and calls `stripe.webhooks.constructEvent`. Emulate webhook delivery fails this check. [Medusa webhook source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/providers/payment-stripe/src/core/stripe-base.ts)

Do not bypass webhook verification in production code or tests. Keep webhook tests outside this change until Emulate sends Stripe-compatible events.

## Test workflow

Add a separate Stripe integration test. Do not extend the territory test with payment transport setup.

Use this lifecycle:

1. Start one Stripe emulator in the suite with `createEmulator`.
2. Reset Emulate before each relevant test.
3. Disable external HTTP access through Nock for that test.
4. Permit loopback HTTP for the Medusa and Emulate servers.
5. Install the exact Payment Intent bridge before each relevant test.
6. Remove the bridge and restore Nock's normal network policy after the test.
7. Close Emulate after the suite.

The test uses public Store API routes from end to end:

```text
GET  /store/products/:id
POST /store/carts
POST /store/payment-collections
POST /store/payment-collections/:id/payment-sessions
```

The cart contains one territory probe Variant for Madrid. Its stored `EUR 100.00` price becomes `EUR 121.00` after peninsular VAT. The payment-session request selects `pp_stripe_stripe`. Medusa documents this route as the operation that initializes a payment session through the selected provider. [Medusa payment flow](https://docs.medusajs.com/resources/commerce-modules/payment/payment-flow), [Store API route source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/medusa/src/api/store/payment-collections/%5Bid%5D/payment-sessions/route.ts)

The official provider converts `EUR 121.00` to `12100` cents. It also adds the Medusa payment-session ID to Stripe metadata as `session_id`. [Medusa amount conversion](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/providers/payment-stripe/src/utils/get-smallest-unit.ts), [Medusa Payment Intent creation](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/providers/payment-stripe/src/core/stripe-base.ts)

After Medusa returns the payment session, read this URL directly from Emulate:

```text
GET <stripeEmulator.url>/v1/payment_intents/<session.data.id>
```

Assert these values:

- The Medusa payment session uses `pp_stripe_stripe`.
- The Medusa session status is pending.
- The provider data contains an ID that starts with `pi_`.
- Emulate returns the same Payment Intent ID.
- The Emulate amount is `12100`.
- The Emulate currency is `eur`.
- The Emulate metadata `session_id` equals the Medusa payment-session ID.
- Nock observed the one expected create request.
- Nock has no unmatched pending bridge request.

This test proves the branch's integration boundary. It does not prove authorization, capture, an Order, or a refund.

## CI and secrets

The existing CI job already runs Node 24 and the Medusa integration suite. Emulate also develops against Node 24. [Emulate root package](https://github.com/vercel-labs/emulate/blob/main/package.json)

No separate CI service is necessary. `bun install --frozen-lockfile` installs the two development dependencies, and Jest owns the emulator lifecycle.

CI needs no Stripe account, Stripe API key, Vercel token, or Emulate secret. Keep the existing dummy value:

```text
STRIPE_API_KEY=sk_test_ci
```

The branch validates only the `sk_` prefix. Emulate accepts the bearer value without contacting Stripe.

Keep `sk_test_integration` in `apps/medusa/.env.test`. Do not add a real secret to the repository.

The Docker smoke job creates no payment session. It must not start Emulate or enable Nock.

Production still needs a real Stripe secret key. A deployed Medusa application also needs a Stripe webhook secret and configured Stripe webhook endpoint. [Medusa Stripe provider documentation](https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider/stripe)

The current branch does not configure `webhookSecret`. This scoped test does not correct that production requirement.

## Acceptance boundary

The Emulate addition is complete when all of these statements are true:

- Emulate and Nock are Medusa development dependencies.
- The integration suite starts Emulate without a separate process.
- External HTTP is blocked during the test.
- Only Payment Intent creation crosses the Nock bridge.
- The test reads the new intent directly from Emulate.
- The existing CI command runs the test without real secrets.
- Compose and production configuration contain no Emulate path.
- The official Medusa Stripe provider remains unchanged.

Do not expand this change when a later operation returns `404`. That failure marks an unsupported Emulate route, not a reason for a broad mock.
