# The seed takes a Territory Declaration

`spain.ts` holds one Territory Declaration: the country, its currency, the Region name, the default tax regime, the Province regimes, the Service Zones, and the stock location. The seed takes a Declaration as a parameter and names no country.

Before this, the Declaration was split. `spain.ts` held the regimes and the Province lists. The Service Zones, the Region name, the stock location, and the Medusa provider ids sat in the seed among the mechanics. A reader who asked what the Spanish territory model was read two files, and separated about forty declarative lines from about three hundred and eighty procedural ones in the second.

## Why a parameter, when there is one country

ADR-0005 states that the country prefix distinguishes ES from FR from DE, and names destination VAT across the EU as a third tax treatment. A second country is therefore anticipated. But no phase schedules one, and a parameter justified by an unscheduled roadmap item is speculative generality.

The justification is the test, not France. A mechanism test applies a toy Declaration for a country that is not Spain and asserts that it lands. That is a second adapter today, and it proves a property nothing else can: the seed does not reach for `es` behind the model. The existing suite cannot prove it, because everything that suite applies is Spain.

The toy Declaration needs a spec file of its own. The runner snapshots the database after `beforeAll`, and the Spanish suite asserts exactly one Region and exactly two Service Zones. A second Region in the same file breaks both.

## What a Declaration holds, and what it does not

A Declaration holds what a gestor or an Operator could read and check: the country, the currency, the Region name, the rates and the Provinces they apply to, the Service Zones and their Provinces, and the name of the stock location.

It does not hold Medusa plumbing. The system payment provider, the system tax provider, the default sales channel name, the fulfillment set name, the `created_by` audit value, and the `automatic_taxes` flag stay in the mechanism. None of them is policy, and a gestor asked to check `tp_system` has been asked the wrong question.

## Consequences

- **ADR-0019 is untouched.** The seed still creates and never corrects. It still finds each piece by something stable, and it still refuses to edit a Service Zone that exists, so an Operator who stops shipping to a Province is not undone by the next deploy. Moving the Declaration changes where the constants live, not who owns the rows.

- **A new Service Zone is declared, not coded.** Adding a zone used to be an edit to the mechanism file. It is now an entry in the Declaration. Adding Provinces to a zone that already exists stays a manual step in the admin, for the reason ADR-0019 gives.

- **The seed reads through named queries.** Entity names and field paths live in the mechanism instead of being repeated at each call site, and the Region lookup pushes its filter down instead of reading every Region and filtering in memory. The integration suite keeps its own accessor deliberately: an assertion that derived from the module the seed writes through would pass on a wrong field path.

- **The probe takes its currency from the seed's result.** It imports nothing from `spain.ts`, so nothing on the mechanism side reaches into Spain.

- **`spain.ts` is imported by the two scripts, the migration script, and the suite.** Not by the mechanism. That is the line to watch. An import of `spain.ts` from the seed means the parameter has stopped being real.

## Related

- ADR-0019 — the database owns the territory model. It uses "territory model" for the whole thing, constants and rows together. `CONTEXT.md` defines **Territory Declaration** for the constants alone, to keep the two senses apart.
- ADR-0005 — Canarias is a Province, not a Region. Why the model resolves at Province granularity, and where FR and DE are anticipated.
