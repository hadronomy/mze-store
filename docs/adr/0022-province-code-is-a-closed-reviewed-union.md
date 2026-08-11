# ProvinceCode is a closed reviewed union

Medusa accepts any string as a Province. It lower-cases that string and looks for a matching Tax Region. When no Province Tax Region matches, Medusa uses the country Tax Region. A typo can therefore give a Canarian Shopper peninsular VAT with no validation error.

The application needs two guarantees. Code that names a Province must get exact autocomplete and compilation errors. Values from cookies, geo-IP providers, requests, Medusa, and the database must pass a runtime membership check before they enter typed Province logic.

## Decision

`@mze-store/territory` owns Province identity data and runtime schemas. It is a pure dual-format package, so Medusa can use its CommonJS output and the Storefront can use its ESM output.

Each country has a package subpath. The Spanish interface is:

```ts
import * as Spain from "@mze-store/territory/spain";

Spain.country;
Spain.provinces;
Spain.provinceCodeSchema.safeParse(input);

type Province = Spain.Province;
type ProvinceCode = Spain.ProvinceCode;
```

The `provinces` tuple is the one source for Spanish Province codes, canonical Spanish reference names, the Zod enum, and the exact `ProvinceCode` union. The package root exports `createProvinceCodeSchema`, `ProvinceList`, and `ProvinceCodeOf` for another country module or a small fixture.

The package checks its reference data when a country module loads. A country code must contain two lower-case ASCII letters. A Province list must be non-empty. Each Province code must use the same country prefix, match the canonical lower-case ISO shape, and occur once. Each name must contain text. The review against an official source proves that a country code is assigned; the factory checks its representation.

The Spanish list has 52 Province-level entries. It was reviewed against the [ISO 3166 Online Browsing Platform](https://www.iso.org/obp/ui/#iso:code:3166:ES) on 2026-08-11. ISO can change this assigned set. Review the country module when the ISO Maintenance Agency publishes a change notification. Do not accept an unknown code until its tax and shipping treatment has been reviewed.

## Boundary policy

The schema is strict. It does not trim, lower-case, add a country prefix, or accept a bare suffix.

Normalization belongs only in a source adapter with a documented external contract. For example, a geo-IP adapter can convert a provider's full upper-case ISO code before it calls the schema.

Fallback also stays outside the schema:

- An invalid Province cookie is ignored or cleared. Resolution then continues through geo-IP and the explicit default.
- An invalid value at the future Storefront request boundary gets a `400` response.
- An invalid Province read from Medusa or the database fails before it enters typed Province logic.
- Every rejection is observable by source. Logs must not put a raw cookie value in a Shopper-facing error.

These consumers arrive with the Storefront territory resolver. This decision defines their contract but does not add that later phase to issue #14.

## Territory Declaration

`TerritoryDeclaration<Country, ProvinceCode>` binds its Province arrays to the selected country. The Spanish Declaration uses the exact Spanish union. The seed remains country-neutral, and the mechanism test can define a small union such as `"pt-30"`.

Province names no longer sit inside tax regime maps. Tax Regions and Service Zones use readonly arrays of `ProvinceCode`. This keeps Province identity separate from tax and shipping policy. It also avoids `Object.keys()`, which widens exact keys to `string[]`.

The database remains authoritative after the first Declaration. The shared package defines accepted identities. It does not own rates, Tax Regions, or Service Zones.

## Rejected alternatives

- A plain `string` has no membership guarantee and preserves the silent tax fallback.
- A template literal checks only shape. It still accepts an unassigned value such as `es-xx`.
- A brand adds authoring work but no runtime check. A valid literal would need a parser or assertion before use.
- A wrapper object breaks direct string use in URLs, JSON, Medusa DTOs, and database queries.
- A generated ISO catalog adds a data pipeline that one country does not need. Revisit generation when a second large country catalog arrives.
- A schema decorated with catalog properties mixes parsing and reference-data access. Plain country-module exports give clearer autocomplete and simpler tests.

## Consequences

- A valid literal remains a normal string. It needs no cast, constructor, or brand helper.
- An unknown, upper-case, partial, or cross-country code fails at compilation or at the runtime schema.
- A new official ISO code fails closed until the reviewed list changes.
- Storefront localization will use `ProvinceCode` as its key. The shared package keeps only canonical Spanish reference names.
- Direct calls to the Medusa Store or Admin API and manual database edits remain outside the TypeScript boundary. Issue #14 adds the parser before phase 3 adds its first untrusted Province consumer. Add a separate Medusa or database control only if direct access becomes an observed risk.

## Related

- [Issue #14 research](../research/issue-14-province-code-types.md)
- ADR-0005 — Canarias is a Province, not a Region.
- ADR-0019 — the database owns the territory model, not the seed.
- ADR-0021 — the seed takes a Territory Declaration.
