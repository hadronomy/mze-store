# ADR-0030: Odoo–Medusa sync uses a typed bridge and split ownership

Status: accepted
Date: 2026-08-20

## Context

Odoo owns operational product data, stock, orders, and invoices. Medusa owns the Shopper-facing catalog and commerce flow. The first integration step must prove private JSON-2 access without creating an order or changing an Odoo record.

The live Odoo deployment already has JSON-2 and API documentation routes. It does not have a Medusa bridge model or a dedicated API key. A direct call to a core Odoo model would couple Medusa to Odoo's internal schema and would make a later write path hard to audit.

## Decision

Add the `mze_medusa_bridge` Odoo addon and one typed Medusa package.

The addon exposes:

- `mze.medusa.bridge/read_catalog_batch` through Odoo JSON-2, marked
  `api.readonly`;
- immutable Odoo Integration Keys on Product and Variant;
- a normalized catalog response with a bounded page size and Source Revision
  cursor. The revision uses the latest Product or Variant `write_date`, so a
  Variant-only change advances the read.

The Medusa package:

- requires `ODOO_BASE_URL` to be the private Odoo route or an in-cluster Odoo service;
- sends `Authorization: bearer <service-user-api-key>` and `X-Odoo-Database`;
- validates the machine documentation before it reads one catalog item;
- fails with `ODOO_ROLLOUT_BLOCKER` when the private route, documented method, authentication, or response contract is unavailable.

The API key belongs to a dedicated Odoo Service User with the bridge documentation and read access only. OpenBao is the source of truth for the key. The public customer hostname, an Operator password, and a database password are not valid credentials for this link.

This ADR covers the read-only integration gate. Order writes, Online Allocation, issued Invoice reads, Catalog Mapping, and durable Sync Records remain later contracts. They must not be added to this method.

## Consequences

The staging gate can prove network reachability, least privilege, and a real normalized fixture before any production write path exists. Odoo owns the source records and keys. Medusa owns the typed client and its failure state.

The addon artifact and its Kubernetes init job must be released together. A
missing addon or method is an explicit rollout blocker. Operators must rotate
the Service User key in Odoo and OpenBao as one operation.

Addon installation assigns missing Integration Keys to existing Product and
Variant rows. That migration is separate from the contract check and must run
in staging before any production release. The contract check itself only
reads documentation and catalog data.

The bridge currently reads the Odoo product catalog. A later sync can add a new method and contract without changing this read-only method's meaning.
