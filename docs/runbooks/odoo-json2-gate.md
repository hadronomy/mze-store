# Odoo JSON-2 read-only gate

This runbook proves the first Odoo–Medusa link. Run it in staging before any
production write path exists. The check reads Odoo documentation and one
catalog batch. It does not create, update, or delete an Odoo record.

Installing the addon assigns missing Integration Keys to existing Product and
Variant rows. Treat that install-time migration as a separate staging change;
the gate does not install or update the addon.

The Odoo JSON-2 API uses a bearer API key and the `X-Odoo-Database` header. See
the [Odoo 19 external API documentation](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html).

## Endpoints

Use one of these private endpoints:

- private route: `https://odoo.eden.mizonaecologica.es`;
- in-cluster service: `http://odoo.odoo.svc.cluster.local:8069`.

The public customer hostname `https://clientes.mizonaecologica.es` is not a
bridge endpoint. The Medusa client rejects it before it sends a request.

The bridge must document and serve these paths:

```text
GET  /doc/index.json                 (browser/session surface)
GET  /doc-bearer/index.json          (Service User surface)
GET  /doc-bearer/mze.medusa.bridge.json
POST /json/2/mze.medusa.bridge/read_catalog_batch
```

The JSON-2 body is a bounded page request. The first check sends
`{"limit":1,"cursor":null}`. The response must match contract
`mze.odoo.catalog.v1` and include one normalized Product and Variant fixture.
The Source Revision cursor advances from the latest Product or Variant
`write_date`.

## Credentials

Create a dedicated Odoo internal Service User in the staging database. Give it
only the `MZE Medusa bridge (read-only)` group. That group grants bridge
documentation and the bridge model. The bridge method checks the group and
reads only the normalized public catalog fields in a read-only elevated
context. Leave password login disabled if the Odoo user form permits it. Do
not add a product manager, system, or Operator group.

Create an API key in the Service User's Account Security page. The key is the
Service User credential. It is not an Odoo admin password and not a database
password.

Store the key in OpenBao at `mze/odoo`, field `medusa_api_key`. The infra
wizard names this value `Odoo Medusa Bridge API Key`. The Medusa deployment
must inject it as `ODOO_API_KEY`; do not put the value in `.env`, source code,
logs, a ticket, or this runbook.

The current infra repository has no Medusa Kubernetes workload. Until that
workload maps this OpenBao field to `ODOO_API_KEY`, the gate remains blocked.
Do not call the gate complete because the OpenBao value exists alone.

## Network and ACL checks

Before the contract check:

1. Run the Medusa workload on the private NetBird or cluster network.
2. Set `ODOO_BASE_URL` to the private route or in-cluster service.
3. Set `ODOO_DATABASE` to the Odoo database name.
4. Confirm that the public customer hostname is not in the Medusa Stage values.
5. Confirm that the Service User has no write, create, or unlink ACL on the
   bridge model, no Product or Variant write ACL, and no product manager group.

The private route is `odoo.eden.mizonaecologica.es`. The public customer
hostname is `clientes.mizonaecologica.es`. A public route check is a rollout failure even
when it returns a successful HTTP response.

## Run the gate

From the MZE Store repository root, run the check with the API key injected by
OpenBao or the deployment secret:

```sh
cd apps/medusa && APP_ENV=production bun run odoo:contract
```

The command builds Medusa and the bridge package, reads the machine documentation,
verifies the bridge model and method, then reads one catalog batch. A passing
result is one JSON line with `status: "ok"`, contract version
`mze.odoo.catalog.v1`, and `catalog_items` greater than zero.

The command exits with status 1 and prints `ODOO_ROLLOUT_BLOCKER` when the
private route, documentation, method, API key, HTTP response, or normalized
fixture is unavailable. Do not work around that error with a core Odoo model or
the public customer hostname.

## Rotation

Rotate the key as one controlled change:

1. Create a new API key on the Service User in Odoo.
2. Store the new value in OpenBao at `mze/odoo`, field `medusa_api_key`.
3. Wait for the deployment secret refresh, or restart the Medusa workload by
   the normal operator procedure.
4. Run the read-only gate and record the result in the deployment change.
5. Revoke the old Odoo API key.

Never record either key in the change log. If the gate fails after rotation,
keep the old key only until the operator confirms the new key works, then
revoke it and stop the rollout.

## No-production-write checklist

Stop before deployment unless every item is true:

- the Odoo addon artifact includes `mze_medusa_bridge`;
- the private `/doc` index lists `mze.medusa.bridge`;
- the Service User can read the matching `/doc-bearer` index and model docs;
- model documentation lists `read_catalog_batch`;
- the Service User has only the read-only bridge group;
- the API key came from OpenBao, not an admin or database password;
- the Medusa workload maps OpenBao path `mze/odoo`, field `medusa_api_key`, to
  `ODOO_API_KEY`;
- the Medusa workload reaches the private route or cluster service;
- the contract check reads one normalized fixture and exits 0;
- no checkout, Order, Invoice, or other Odoo write path is enabled by this
  change.

If the addon or method is missing, record that as the rollout blocker. Do not
use an unapproved JSON-2 method as a fallback.

## Operator helper

The human-only credential steps are in
[`scripts/odoo-json2-setup.sh`](../../scripts/odoo-json2-setup.sh). The helper
does not ask for or write the API key. It writes only the private base URL and
database name to `apps/medusa/.env` after the operator confirms a staging
session.
