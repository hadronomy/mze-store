# Issue 17: Tax Rate audit trail

Date: 2026-08-11

## Result

Do not use the standard Tax Rate events as the audit record.

Use a small, append-only Medusa module for Tax Rate audit records. Write the
record at an authenticated mutation boundary that still has the Operator and
the old Tax Rate. Expose the records through an authenticated Admin API route
and a Medusa Admin page.

The standard events remain useful as a gap detector. They cannot supply the
required audit data on their own.

## Scope and repository decisions

[Issue 17](https://github.com/hadronomy/mze-store/issues/17) requires the
Operator, Province, old rate, new rate, and time for every Tax Rate create and
update. The record must survive a restart. An Operator or gestor must read it
without database access.

The database owns live Tax Rates after the first Territory Declaration. No
audit process can compare them with `src/territory/spain.ts`, correct them, or
restore Declaration values. [ADR-0019](../adr/0019-the-database-owns-the-territory-model.md)
defines this ownership.

Redis supplies the event bus from the first deploy.
[ADR-0006](../adr/0006-redis-from-the-first-deploy.md) makes Redis part of the
correctness design. Redis transports work across a restart. It is not the
permanent audit store.

The project uses Medusa `2.18.0`.
[`bun.lock`](../../bun.lock) pins this version. The findings below use the
installed `2.18.0` source and the same tagged Medusa source.

## Tax Rate event contract

`TaxModuleService.createTaxRates` and `updateTaxRates` both use
`@EmitEvents()`.
[Create source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/tax/src/services/tax-module-service.ts#L84-L116),
[update source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/tax/src/services/tax-module-service.ts#L157-L215)

Medusa maps ORM `afterCreate` and `afterUpdate` mutations to `created` and
`updated`. It then passes only the entity ID to the event builder.
[Mutation event source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/core/utils/src/modules-sdk/medusa-service.ts#L424-L474)

The event builder reduces its input to `{ id }`. For multiple IDs, the value
of `id` is an array. It does not include an entity snapshot or a change set.
[Event builder source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/core/utils/src/modules-sdk/event-builder-factory.ts#L38-L74)

The event names are:

- `tax.tax-rate.created`
- `tax.tax-rate.updated`

These names follow from the `tax` module name, the `TaxRate` model name, and
Medusa's module event formatter. This conclusion is an inference from the
tagged source.
[Tax module source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/tax/src/index.ts),
[event-name formatter](https://github.com/medusajs/medusa/blob/v2.18.0/packages/core/utils/src/event-bus/utils.ts#L10-L31)

Use this subscriber payload type for the current Admin operations:

```ts
SubscriberArgs<{ id: string }>;
```

Code that also handles service-level batch mutations must accept
`{ id: string | string[] }`.

`SubscriberArgs<T>` contains `event`, `container`, and `pluginOptions`.
`SubscriberConfig` selects one event or an array of events. Its optional
`context.subscriberId` identifies the subscriber during retry processing. It
does not identify an Operator.
[Subscriber types](https://github.com/medusajs/medusa/blob/v2.18.0/packages/core/framework/src/subscribers/types.ts#L1-L16),
[event subscriber context](https://github.com/medusajs/medusa/blob/v2.18.0/packages/core/types/src/event-bus/common.ts#L25-L37)

The event metadata contains `source`, `object`, and `action`. Medusa can add an
event group and the event bus can add creation and publication times. The raw
event context preserves only `eventGroupId`. It does not preserve `requestId`
or an authentication context.
[Message composition](https://github.com/medusajs/medusa/blob/v2.18.0/packages/core/utils/src/event-bus/build-event-messages.ts#L11-L51),
[event types](https://github.com/medusajs/medusa/blob/v2.18.0/packages/core/types/src/event-bus/common.ts#L39-L90)

## Operator identity gap

The Admin create route adds `req.auth_context.actor_id` as `created_by`.
A subscriber can query the new Tax Rate and read this value.
[Create route](https://github.com/medusajs/medusa/blob/v2.18.0/packages/medusa/src/api/admin/tax-rates/route.ts#L13-L34)

The Admin update route adds the same Operator ID as `updated_by` in the
workflow input.
[Update route](https://github.com/medusajs/medusa/blob/v2.18.0/packages/medusa/src/api/admin/tax-rates/%5Bid%5D/route.ts#L17-L45)

`updated_by` does not become part of the Tax Rate event or Tax Rate row. The
Tax Rate model has `created_by` and has no `updated_by` field.
[Tax Rate model](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/tax/src/models/tax-rate.ts#L5-L21)

The update DTO marks `updated_by` as an internal field. The workflow uses it
to attribute replacement Tax Rate Rules. The workflow does not expose it to a
subscriber.
[Update DTO](https://github.com/medusajs/medusa/blob/v2.18.0/packages/core/types/src/tax/mutations.ts#L150-L181),
[update workflow](https://github.com/medusajs/medusa/blob/v2.18.0/packages/core/core-flows/src/tax/workflows/update-tax-rates.ts#L145-L205)

Therefore, the standard update event cannot identify the Operator. Querying
the Operator after the event does not help because the event contains no
Operator ID.

## Old-value and ordering gap

The standard update event contains no old or new rate. A subscriber can query
the current Tax Rate after it receives the event. That query gives only the
latest state at query time.

Two updates can commit before the first subscriber query runs. Both event
handlers can then read the second value. The first change and its old value
are lost from the audit history.

The core update step reads prior data for workflow compensation. It does not
return that data as workflow output or event data.
[Update step](https://github.com/medusajs/medusa/blob/v2.18.0/packages/core/core-flows/src/tax/steps/update-tax-rates.ts#L40-L66)

An audit subscriber cannot reconstruct the first old value from earlier audit
rows. The first update after deployment has no earlier row. Delayed or
concurrent delivery also makes reconstruction unsafe.

## Redis durability limits

The Redis event bus queues asynchronous jobs. Its default job options are one
attempt and `removeOnComplete: true`.
[Redis event options](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/event-bus-redis/src/services/event-bus-redis.ts#L134-L174)

The worker records successful subscriber IDs only for configured retries. It
logs subscriber errors. A failed subscriber is not a permanent audit record.
[Redis worker](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/event-bus-redis/src/services/event-bus-redis.ts#L398-L507)

The current Redis event-bus registration sets only `redisUrl`.
[`apps/medusa/medusa-config.ts`](../../apps/medusa/medusa-config.ts) does not
set job attempts or retention.

More attempts reduce transient loss. They do not add the Operator, the old
rate, a unique event ID, or permanent history. The subscriber must also be
idempotent because retry delivery can repeat work.

## Persistence design

Create a custom module with an append-only `tax_rate_audit` data model. Medusa
data models map to database tables and include standard timestamps. A module
service supplies persistence methods, and module migrations create the table.
[Medusa data-model guide](https://docs.medusajs.com/learn/fundamentals/data-models),
[module isolation](https://docs.medusajs.com/learn/fundamentals/modules/isolation)

Store snapshots instead of live relations for facts that must remain clear
after later edits:

| Field                 | Purpose                                                      |
| --------------------- | ------------------------------------------------------------ |
| `id`                  | Stable audit-record ID                                       |
| `operation_id`        | Unique source operation ID used for idempotent append        |
| `request_fingerprint` | SHA-256 of the operation kind, actor, and validated input    |
| `tax_rate_id`         | The affected Tax Rate                                        |
| `tax_region_id`       | The affected Tax Region at change time                       |
| `country_code`        | The country at change time                                   |
| `province_code`       | The Province at change time, or `null` for a country default |
| `tax_rate_name`       | The Tax Rate name at change time                             |
| `tax_rate_code`       | The Tax Rate code at change time                             |
| `action`              | `created` or `updated`                                       |
| `before_rate`         | The old rate, or `null` for creation                         |
| `after_rate`          | The new rate, checked against the completed mutation         |
| `actor_kind`          | `operator` or `system`                                       |
| `actor_id`            | The authenticated Operator or system actor ID                |
| `actor_email`         | A display snapshot if the Operator record later changes      |
| `occurred_at`         | The database time for the completed change                   |

Keep completed audit facts append-only at the public module interface and API
seams. Do not offer update or delete routes. Workflow compensation can remove
a row from a failed operation before the workflow returns an error. Database
access remains an administrative escape hatch, so access control and backups
still matter.

OWASP describes the core audit fields as “when, where, who and what.” It also
requires protection from unauthorized modification and deletion.
[OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#event-attributes)

## Mutation boundary

The authenticated route is the last standard seam that has the Operator. The
workflow update step is the last standard seam that reads the old Tax Rate.
The audited workflow joins these facts with the completed mutation result.

Use a custom audited mutation workflow and an Admin mutation route. The
workflow writes the Tax Rate first. It appends the audit row in the next step.
If the append fails, workflow compensation restores the Tax Rate and removes
audit rows from the failed operation.

Block direct use of the original create and update mutation routes when the
audited route is ready. The Admin Tax Rate editor must use the audited route.
Otherwise, the original route remains an unaudited bypass. Medusa recommends
a replicated route when existing route extension points do not meet the
requirement.
[Medusa route guidance](https://docs.medusajs.com/learn/fundamentals/api-routes/override)

This design is larger than a subscriber because the current Medusa contract
does not carry the required evidence. Adding the evidence to Tax Rate
`metadata`, using process-local request state, or reading the row after the
event does not give an append-only, concurrency-safe record.

### Applied implementation decision

The accepted implementation writes the Tax Rate first and appends the audit
row as the next step in the same workflow. If the append fails, workflow
compensation restores the Tax Rate and removes any audit rows created by that
attempt. This keeps the existing Tax Rate Rules behavior in Medusa's core
workflow while keeping the audit write durable and queryable.

The update workflow locks one Tax Rate through the snapshot, mutation, and
append. The mutation boundary also locks each operation ID before it checks
the audit module or starts a workflow. A separate operation ledger stores the
result resource for each completed request. This lets a Tax Region create
replay safely even when it has no default Tax Rate. A retry with different
validated input fails with a conflict because its request fingerprint differs.
Seed-created rows use the `system` actor. Admin routes use the authenticated
Operator ID and store an email snapshot. The audit module exposes no delete
operation. Delete behavior for Tax Rates remains unchanged.

## Operator-readable surface

Add an authenticated Admin API list route over the audit module. Support
filters for Tax Rate, Tax Region, Province, Operator, action, and time. Return
newest records first.

Add a Medusa Admin UI route for the history. The page can appear in the Admin
sidebar or under the settings route hierarchy. Medusa supports file-based
custom UI routes, sidebar route configuration, route loaders, and standard
React Router navigation.
[Admin UI routes](https://docs.medusajs.com/learn/fundamentals/admin/ui-routes),
[Admin routing](https://docs.medusajs.com/learn/fundamentals/admin/routing)

Show these values without requiring a detail click:

- time
- Province
- Tax Rate name and ID
- old rate and new rate
- Operator email and ID

Do not read the present Tax Rate to replace historical snapshot fields.

## Acceptance check

| Criterion                                                | Required design element                              |
| -------------------------------------------------------- | ---------------------------------------------------- |
| Every create and update has all values                   | Audited mutation boundary with old and new snapshots |
| The record survives restart                              | Custom database data model                           |
| An Operator or gestor can answer without database access | Authenticated Admin API and Admin UI route           |
| No Declaration comparison                                | Audit reads the mutation and database rows only      |

## Tests

- Create a Province Tax Region and a direct Tax Rate through the Admin routes.
- Repeat each operation ID and make sure that one audit row exists.
- Replay a Tax Region create that has no default Tax Rate.
- Reuse one operation ID with different input and require a conflict.
- Update one Tax Rate twice and inspect the two before-and-after transitions.
- Use two Operators and inspect the Operator on each row.
- Run the repository seed twice and inspect one `system` row per Tax Rate.
- Query history with valid filters and reject invalid query values through Zod.
- Make sure that the implementation never imports `src/territory/spain.ts`.
