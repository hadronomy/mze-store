# Erasure scrubs the profile, deletes the credentials, keeps the ledger

"Delete my account" is not a deletion. It is three different operations on three things with three different legal statuses, tracked as a first-class Erasure Request.

## The trap

Medusa's stock `removeCustomerAccountWorkflow` does **not** erase anything:

```js
await service.softDeleteCustomers(ids); // deleteCustomersStep
```

It soft-deletes. The row survives with `deleted_at` set, and email, name, and phone stay in Postgres indefinitely. Because the Customer vanishes from every admin list, this looks correct while being a compliance failure. Wiring "delete my account" to the stock workflow is the obvious move and the wrong one.

## What actually happens

- **Account** — hard-deleted in better-auth. Credentials, sessions, and verification state have no retention justification.
- **Customer** — scrubbed in place, not deleted. Email overwritten with an unroutable sentinel, names and phone nulled, addresses removed. The row survives as a tombstone so `order.customer_id` stays intact and returns, disputes, and audits still work.
- **Orders** — retained on an **operational** clock: long enough for returns, warranty, and chargebacks. Not an accounting clock. An Order is not an Invoice (see below), so the multi-year retention duty does not attach here.
- **Orders past that window** — scrubbed by a scheduled purge, satisfying storage limitation.
- **Invoices** — not Medusa's concern at all. Odoo issues and retains them under accounting law (ADR-0017), lawfully and untouched by this workflow.

This works cleanly because `order.email` and order addresses are **snapshots** taken at placement. An Order is self-contained and survives its Customer being scrubbed.

### Order is not Invoice

Medusa has **no invoice concept** — no entity, no types, no workflows, and no `invoice` table among the 150+ it creates. Treating an Order as the retained financial record confuses two artifacts with different owners and different clocks:

| Artifact | Owner       | Retained because            | Clock               |
| -------- | ----------- | --------------------------- | ------------------- |
| Account  | better-auth | nothing                     | deleted on request  |
| Order    | Medusa      | returns, warranty, disputes | operational — short |
| Invoice  | **Odoo**    | accounting and tax law      | legal — years       |

An Erasure therefore does not delete anything in Odoo. GDPR requires telling the Shopper what is retained and why; "your invoices are kept under accounting law for N years" is the lawful and honest response, not a failure to comply.

### Rendered artifacts

A purge that only touches Postgres leaves rendered documents intact — a PDF in object storage holds a name and address no `UPDATE` will reach.

ADR-0018 removes this problem rather than solving it: invoice PDFs are rendered per request and never stored, so there is no rendered artifact to chase. Any future feature that persists a generated document reintroduces the obligation and must extend the purge.

Database **backups** remain in scope and are not addressed here. The usual position — backups are exempt while they rotate out on a defined schedule and are never restored-and-reused — requires a documented backup retention policy this project does not yet have.

## Why it is a tracked request, not an event

Erasure spans two systems and carries a legal clock — one month to respond under Art. 12(3), and an accountability duty under Art. 5(2) to demonstrate it happened.

A deletion hook that calls across systems has a specific failure mode: the Account is gone, the Customer is never scrubbed, and nothing anywhere records that it should have been. No retry anchor, no alarm, discovered during an audit. So an `ErasureRequest` is a real model in a small custom Medusa module, with a workflow and a scheduled job that both retries incomplete requests and runs the retention purge.

Medusa owns it — not better-auth, despite better-auth owning Accounts — because that is where the Redis-backed workflow engine, retries, and compensation live (ADR-0006).

## Consequences

- Deleting the Account is a _step inside_ the erasure workflow, never the trigger.
- The workflow must be idempotent and compensating: a scrubbed Customer whose Account deletion failed must be retryable without corrupting either side.
- The scheduled purge runs forever and needs monitoring. A silently dead purge job is the same class of failure as the silent hook.
- Erasure capability is required at launch, not later. Guest checkout means personal data exists from the first order.
