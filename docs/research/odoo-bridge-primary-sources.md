# Odoo 19 JSON-2 bridge: primary-source research

**Date checked:** 2026-08-20

**Scope:** Odoo 19 JSON-2, bearer authentication, dynamic documentation, the
`@api.readonly` contract, and the current MZE bridge package and addon.

## Result

Keep JSON-2 as the transport for the first Odoo bridge. The current package
matches the Odoo 19 request shape:

- `POST /json/2/<model>/<method>`;
- `Authorization: bearer <API key>`;
- `Content-Type: application/json`;
- an object body with named method arguments; and
- `X-Odoo-Database` when the deployment needs explicit database selection.

The package must continue to validate the method documentation and the
normalized response. JSON-2 returns the method's value as JSON. It does not
provide an MZE response envelope or a generated TypeScript type.

`@api.readonly` is useful for the bridge, but it is not an access-control
boundary. It marks a method for a read-only database cursor when Odoo resolves
the JSON-2 route. Odoo can retry with a read/write cursor if the method attempts
a write. The bridge group and the method's implementation remain responsible
for authorization and read-only behavior.

## Official Odoo documentation

### Request and response

The [Odoo 19 External JSON-2 API documentation](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html)
defines JSON-2 as a version 19 API. The request uses a `POST` URL containing the
technical model and method. The body is a JSON object. `ids` and `context` are
reserved request members, and all other method arguments are named; positional
arguments are not supported. Success returns HTTP 200 with the JSON-serialized
method result. Errors use a 4xx or 5xx status and a JSON object containing the
exception name, message, arguments, request context, and debug data.

Implications for MZE:

- `read_catalog_batch` must keep `limit` and `cursor` as named body members.
- It is an `@api.model` method, so the client must omit `ids`.
- The Effect Schema response schemas are required. JSON-2 has no schema negotiation.
- The client must not expose Odoo's `debug` field or echo the API key in an
  error. The current client only reports status and redacts transport errors.

### Authentication, keys, access, and database selection

The same documentation requires a bearer API key in the `Authorization`
header. It documents the `rpc` key scope as the generic scope for RPC routes
with `auth='bearer'`. It recommends dedicated bot users for long-running
integrations, minimum permissions, an empty password when password login is not
needed, and separate keys with deliberate rotation. Access is checked through
Odoo's normal access rights, record rules, and field access.

The `Host` header selects the server. `X-Odoo-Database` is optional when the
host identifies one database, and required when one host serves several
databases without a host-based `dbfilter`.

Implications for MZE:

- The Service User must own the key. Do not use an Operator password or a
  database password.
- `X-Odoo-Database: odoo` is safe for the current deployment and protects the
  multi-database case.
- The package's private-host allowlist is an MZE network policy. It is stricter
  than Odoo's API and must stay in place.
- The addon's `sudo()` product reads make the bridge group the effective
  authorization boundary for the normalized catalog. Keep that group narrow
  and keep the serialized field allowlist explicit.

### Transaction behavior

The JSON-2 documentation states that each call runs in its own SQL
transaction. Odoo commits a successful call and discards a failed call. Two
consecutive API calls cannot share one transaction, so related operations that
need atomicity belong in one model method.

The first MZE method is a single read-only catalog page. The boundary is a good
fit. Later order, reservation, or invoice workflows must use one Odoo method
per atomic act instead of a client-side sequence of dependent calls.

## Odoo 19 source behavior

The following links point to Odoo commit
[`0d44f26d9b0fb1c1a5db463cf1f8dd0d3c72ba26`](https://github.com/odoo/odoo/commit/0d44f26d9b0fb1c1a5db463cf1f8dd0d3c72ba26),
the source revision checked on 2026-08-20.

### JSON-2 dispatch

[`addons/rpc/controllers/json2.py`](https://github.com/odoo/odoo/blob/0d44f26d9b0fb1c1a5db463cf1f8dd0d3c72ba26/addons/rpc/controllers/json2.py)
registers `/json/2/<__model__>/<__method__>` for `POST`, `auth='bearer'`, and
`type='json2'`. The dispatcher:

1. resolves the model from the URL;
2. resolves a public method;
3. rejects `ids` for an `@api.model` method;
4. binds the named JSON members to the Python signature;
5. calls the method; and
6. converts a returned recordset to its ID list.

This confirms that the bridge method must return a plain serializable object,
not an Odoo recordset. It also means a method signature change is an API
breaking change even when the URL stays the same.

### `@api.model` and `@api.readonly`

[`odoo/orm/decorators.py`](https://github.com/odoo/odoo/blob/0d44f26d9b0fb1c1a5db463cf1f8dd0d3c72ba26/odoo/orm/decorators.py)
sets `_api_model` for `@api.model` and `_readonly` for `@api.readonly`.
The JSON-2 controller's dynamic `readonly` callback walks the model MRO and
reads `_readonly` from the selected method.

[`odoo/http.py`](https://github.com/odoo/odoo/blob/0d44f26d9b0fb1c1a5db463cf1f8dd0d3c72ba26/odoo/http.py)
describes route `readonly` as opening a cursor on a read-only replica. If a
read-only route raises PostgreSQL's `ReadOnlySqlTransaction`, Odoo retries the
request with a read/write cursor. Therefore:

- `@api.readonly` is a routing and database-safety hint;
- it is visible in Odoo's generated method metadata; and
- it does not replace ACLs, group checks, or code review for writes.

### Dynamic documentation and `/doc-bearer`

[`addons/api_doc/controllers/api_doc.py`](https://github.com/odoo/odoo/blob/0d44f26d9b0fb1c1a5db463cf1f8dd0d3c72ba26/addons/api_doc/controllers/api_doc.py)
registers:

- `/doc-bearer/index.json` with `auth='bearer'`;
- `/doc-bearer/<model_name>.json` with `auth='bearer'` and `readonly=True`.

Both delegate to documentation handlers that require the user to belong to
`api_doc.group_allow_doc`. The index lists installed modules and readable
models with method names. A model document contains the model metadata, fields,
and method metadata. The method metadata includes an `api` list with entries
such as `model` and `readonly`.

The index route itself does not declare `readonly=True` in Odoo 19. It can
generate and cache an attachment when the cache is cold. The model document
route is explicitly read-only. The package's `Cache-Control: no-cache` forces a
fresh index response, which is useful for a rollout gate but can cost more than
a normal cached request.

[`addons/api_doc/tests/test_doc.py`](https://github.com/odoo/odoo/blob/0d44f26d9b0fb1c1a5db463cf1f8dd0d3c72ba26/addons/api_doc/tests/test_doc.py)
confirms that both bearer documentation paths are fetched with `GET`, return
HTTP 200 JSON for a user with the documentation group, and expose method and
field metadata.

### Error and status behavior

[`odoo/addons/test_http/tests/test_webjson2.py`](https://github.com/odoo/odoo/blob/0d44f26d9b0fb1c1a5db463cf1f8dd0d3c72ba26/odoo/addons/test_http/tests/test_webjson2.py)
tests the live protocol shape. Missing bearer authentication returns 401 with a
bearer challenge. Invalid method arguments return 422. An access failure
returns 403. Valid calls return JSON with HTTP 200. The JSON error object also
contains a debug traceback in test mode, so callers must treat the body as
sensitive diagnostic data.

## Fit against the current MZE code

The checked package is:

- [`packages/odoo-bridge/src/effect.ts`](../../packages/odoo-bridge/src/effect.ts),
  which enforces the private endpoint allowlist, sends bearer and database
  headers, performs `GET` documentation checks and `POST` JSON-2 calls, and
  classifies transport, status, timeout, pagination, and schema failures; and
- [`packages/odoo-bridge/src/contract.ts`](../../packages/odoo-bridge/src/contract.ts),
  which owns the Effect Schema contracts, bounds pages to 100 items, validates
  the source-revision cursor, and requires the literal model, method, and
  contract version.

The Promise and CommonJS edge is in
[`packages/odoo-bridge/src/promise.ts`](../../packages/odoo-bridge/src/promise.ts).
It runs the Effect service without exposing Effect types to Medusa.

The addon source checked at
`mze-infra@92ba963790e41e9927e5b9bba9001a991a529f05` is:

- `odoo/addons/mze_medusa_bridge/models/bridge.py`, which marks
  `read_catalog_batch` with `@api.model` and `@api.readonly`, checks the bridge
  group, uses `sudo()` for product reads, and returns the bounded normalized
  catalog object; and
- `odoo/addons/mze_medusa_bridge/security/mze_medusa_bridge_security.xml` plus
  `security/ir.model.access.csv`, which grant documentation access and bridge
  model read access to the dedicated group only.

The current contract gate is aligned with Odoo's source behavior: it checks the
bearer documentation index, checks that the method is documented and marked
`readonly`, then reads one normalized fixture. Keep this order. It gives a
clear rollout failure before catalog data is consumed.

## Sources not used

No forum posts, vendor SDKs, or third-party Odoo client libraries were used for
protocol claims. The official documentation and Odoo's 19.0 source and tests
own the behavior described here.
