# The database owns the territory model, not the seed

ADR-0005 decides that Canarias is a Province. This decides who owns the rows that come out of it.

Every piece of the territory model exists twice: as constants in `apps/medusa/src/territory/spain.ts`, and as rows an Operator edits in the Medusa admin. The admin ships full CRUD for all of it — Tax Regions with per-Province pages and rate editing, Service Zones and their geo zones, Regions, tax overrides. Adding Ceuta and Melilla is a form, not a deploy.

**The database is authoritative. The constants only start a new one.**

## Why not the code

A rate changes by law, on a date no release schedule can predict. The gestor who confirms a rate talks to an Operator, not to a developer. And nothing reads `spain.ts` at run time — only the code that creates a database that has no model yet.

The tempting alternative is a converging seed: one source of truth in version control, applied on every deploy, drift impossible by construction. It is the right answer for a Kubernetes manifest and the wrong one here. It reverts a lawful rate change at the next release, silently, and the Operator who made the change has no way to make it stick short of a pull request. A tax rate is not a deployment artifact.

## Consequences

- **The seed creates and never corrects.** It finds each piece by something stable — the Region by the country it carries, a Tax Region by its Province, a Service Zone by its name — and creates only what is absent. A second run does nothing.

- **A Service Zone is not reconciled either.** An earlier version added Provinces that a zone was missing, which broke this decision the moment the model started arriving on deploy: an Operator who stops shipping to a Province leaves a hole indistinguishable from one the seed never filled, and the next release would undo them. Telling the two apart needs a marker of intent that would exist only to serve the seed. So the seed creates a zone that is absent and never edits one that is there. A new regime's Provinces are added in the admin.

- **The model arrives as a run-once migration script.** `medusa db:migrate` runs `src/migration-scripts/`, records each file by name in `script_migrations`, and never runs it again. This makes "creates, never corrects" structural rather than a property maintained by hand, and it costs a deployment no second application boot. A later change to the model is a new file beside the first, not an edit to it — the history is append-only, and nothing reaches back over an Operator.

- **Constants in `spain.ts` are the starting state, not the policy.** Documentation that called that file "the only place a rate is written" was wrong and has been corrected. A gestor approves the rate that the admin shows.

- **The tests assert a freshly seeded database.** They say nothing about a live store, and cannot: the rates they check are the ones the seed wrote, and a live store's rates are the ones an Operator set.

- **A wrong rate is caught by a human, or not at all.** Comparing the database against the constants would fire on every lawful change and stay silent on `7` mistyped as `0.7`. There is no automated guard, deliberately, until there is a Shopper who can be overcharged. The gestor's approval in the admin is the control, and it is manual. An audit trail over the tax module's rate events is the intended first automated step, tracked separately.

## Related

- ADR-0005 — Canarias is a Province, not a Region. The model this one assigns ownership of.
- ADR-0006 — Redis from the first deploy. The migration-script runner takes its lock from the locking module registered there, which is what makes parallel deploys safe.
