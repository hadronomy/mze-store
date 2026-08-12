# Issue #14: Province code type design

Date: 2026-08-11

## Recommendation

Use a closed `ProvinceCode` literal union and one runtime enum schema for each
country. Derive both from one `as const` tuple of Province records.

Do not add a brand to this union. A brand makes valid literals harder to write
and gives no additional runtime check.

Make the Territory Declaration generic over its country and Province code
type. Then use
`satisfies TerritoryDeclaration<typeof Spain.country, Spain.ProvinceCode>` for
the Spanish Declaration.

Use the runtime schema on every untrusted value before Medusa receives it.
Cookies, geo-IP responses, JSON, and database reads are untrusted values.

Keep the internal parser strict. A provider adapter can normalize a documented
external format before it calls the parser.

This design gives the following properties:

- A plain literal such as `"es-tf"` needs no cast or constructor.
- An unknown code such as `"es-xx"` fails during compilation and at runtime.
- A fragment such as `"tf"` fails during compilation and at runtime.
- An upper-case value such as `"ES-TF"` fails at the internal boundary.
- The parsed value remains a string for JSON, database, URL, and Medusa use.
- One list controls autocomplete, declaration checks, and runtime membership.

The approved package interface is:

```ts
import * as Spain from "@mze-store/territory/spain";

Spain.country;
Spain.provinces;
Spain.provinceCodeSchema.safeParse(input);

type Province = Spain.Province;
type ProvinceCode = Spain.ProvinceCode;
```

The package root exports `createProvinceCodeSchema`, `ProvinceList`, and
`ProvinceCodeOf`. The factory checks the country module's reference data when
the module loads and creates the exact Zod enum from the Province tuple.

The Spanish country module uses plain exports:

```ts
export const country = "es";

export const provinces = [
  { code: "es-a", name: "Alicante" },
  // ...the other reviewed Province-level entries...
  { code: "es-tf", name: "Santa Cruz de Tenerife" },
] as const satisfies ProvinceList<typeof country>;

export const provinceCodeSchema = createProvinceCodeSchema(country, provinces);
```

This avoids a global `SPANISH_PROVINCE_CATALOG` container and avoids attaching
catalog properties to a Zod schema. The tax and shipping lists stay independent
of the canonical reference names.

## Why the issue matters

Before the issue #14 change, the Declaration stored Province lists as
`Record<string, string>` and `string[]`. The seed also accepted
`province: string`.
At that point, [`declaration.ts`](../../apps/medusa/src/territory/declaration.ts)
and [`seed.ts`](../../apps/medusa/src/territory/seed.ts) carried no code
invariant.

Those three lists contained 52 codes. They included 48 peninsular or Balearic
codes, two Canarian codes, and two IPSI codes.
The Spanish country module is now the identity source.
[`spain.ts`](../../packages/territory/src/spain.ts)

The failure is silent in Medusa 2.18.0. Its Store product validator accepts any
string as `province`.
[Medusa Store validator](https://github.com/medusajs/medusa/blob/v2.18.0/packages/medusa/src/api/store/products/validators.ts#L10-L19)

Medusa lower-cases the Province in the tax calculation context. It also
lower-cases a Tax Region code before creation.
[Tax context normalization](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/tax/src/services/tax-module-service.ts#L551-L564),
[Tax Region input normalization](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/tax/src/services/tax-module-service.ts#L584-L596),
[normalizer](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/tax/src/services/tax-module-service.ts#L842-L844)

The tax query asks for the country Tax Region and the matching Province Tax
Region. An unknown Province therefore leaves only the country Tax Region.
[Medusa tax selection](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/tax/src/services/tax-module-service.ts#L407-L435)

The fulfillment boundary is also open. Its API validator accepts
`province_code` as a string, and its geo-zone model stores text.
[geo-zone validator](https://github.com/medusajs/medusa/blob/v2.18.0/packages/medusa/src/api/admin/fulfillment-sets/validators/geo-zone.ts#L10-L35),
[geo-zone model](https://github.com/medusajs/medusa/blob/v2.18.0/packages/modules/fulfillment/src/models/geo-zone.ts#L24-L50)

These Medusa types are useful interop boundaries. They are not domain
validators.

## ISO facts and the project representation

ISO 3166-2 defines country subdivision codes. ISO confirmed the current 2020
edition in 2025.
[ISO 3166-2:2020](https://www.iso.org/standard/72483.html)

ISO forms a subdivision code from a two-letter country code, a separator, and
up to three alphanumeric characters.
[ISO 3166 glossary](https://www.iso.org/home/standards/popular-standards/iso-3166-country-codes/glossary-for-iso-3166.html)

The official examples use upper case. This project uses a lower-case Medusa
representation. `es-tf` is therefore a project canonical value for `ES-TF`.

The ISO Maintenance Agency updates the assigned set. The Online Browsing
Platform is the current source and supports change notifications.
[ISO 3166 access and maintenance](https://www.iso.org/iso-3166-country-codes.html)

This maintenance model creates a closed-world risk. A new official Spanish
code will fail until this repository updates its list.

That failure is safer than accepting every well-shaped string. A new Province
needs explicit tax and shipping treatment before a Shopper uses it.

The closed list does not make code authoritative for tax policy. It defines
accepted identifiers. The database still owns rates, Tax Regions, and Service
Zones after the first Declaration.
[`ADR-0019`](../adr/0019-the-database-owns-the-territory-model.md)

## TypeScript behavior

TypeScript erases types after compilation. A union, template type, or brand
cannot validate a cookie or a JSON value by itself.
[TypeScript erased types](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch.html#erased-types)

`as const` prevents literal widening and makes arrays readonly tuples. This is
what preserves each Province code as a literal.
[TypeScript 3.4 const assertions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html#const-assertions)

The `satisfies` operator checks an expression without replacing its inferred
type. It gives exact authoring checks without losing literal information.
[TypeScript 4.9 `satisfies`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)

Template literal types combine string literal sets. They do not know the ISO
assigned set unless that set already exists as a union.
[TypeScript template literal types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html)

A local TypeScript 6.0.3 compiler probe produced these results:

- `` `es-${Lowercase<string>}` `` accepted `"es-xx"`.
- The same type accepted `"es-"`.
- The same type rejected `"es-TF"`.
- A `unique symbol` string brand rejected the plain literal `"es-tf"`.
- `Object.keys()` changed `("es-m" | "es-tf")[]` to `string[]`.
- `satisfies` kept a value such as `"Madrid"` as its literal type.

The last result follows the standard library declaration. TypeScript 6.0.3
declares `Object.keys` as returning `string[]`.
[TypeScript 6.0.3 standard library](https://github.com/microsoft/TypeScript/blob/v6.0.3/src/lib/es2015.core.d.ts#L316-L324)

This widening is a reason to use Province arrays in the Declaration. The seed
then stops converting maps through `Object.keys()`.

TypeScript also declares `JSON.parse` as returning `any`. Pass its result
directly to the runtime schema, or first assign it to `unknown`.
[TypeScript 6.0.3 JSON declaration](https://github.com/microsoft/TypeScript/blob/v6.0.3/src/lib/es5.d.ts#L1153-L1162)

## Alternative comparison

| Design                  | Compile-time guarantee    | Runtime edge                          | Literal authoring          | Interop and cost               | Main risk                          |
| ----------------------- | ------------------------- | ------------------------------------- | -------------------------- | ------------------------------ | ---------------------------------- |
| Plain `string`          | None                      | None                                  | Excellent                  | Native string, no cost         | Silent default tax                 |
| Template type           | Shape only                | None                                  | Good                       | Native string, no cost         | Accepts unassigned codes           |
| Branded string          | Rejects unbranded strings | Needs a parser                        | Poor without a constructor | Native string after erasure    | Parser quality controls all safety |
| Closed union            | Exact known set           | Needs a parser                        | Excellent                  | Native string, no runtime cost | ISO list can change                |
| Union plus custom `Set` | Exact known set           | Membership check                      | Excellent                  | Smallest runtime code          | One trusted predicate or cast      |
| Union plus Zod enum     | Exact known set           | Membership check and structured error | Excellent                  | Small runtime dependency       | ISO list can change                |
| Wrapper object or class | Nominal at runtime        | Constructor                           | Poor                       | Breaks direct string interop   | Serialization and allocation noise |
| ISO-generated union     | Exact downloaded set      | Generated parser                      | Excellent for consumers    | Generator and data pipeline    | Source access and update failures  |

### Branded or opaque strings

A common brand uses `string & { readonly [brand]: ... }` with a
`unique symbol`. Unique symbols give separate compile-time identities.
[TypeScript unique symbols](https://www.typescriptlang.org/docs/handbook/symbols.html#unique-symbol)

The brand still disappears at runtime. It is assignable to `string`, so
Medusa and JSON output work. JSON input must pass through the parser again.

Zod 4.4.3 implements a brand as a type intersection. Its runtime `.brand()`
method returns the same schema instance.
[Zod brand type](https://github.com/colinhacks/zod/blob/v4.4.3/packages/zod/src/v4/core/core.ts#L79-L95),
[Zod brand runtime](https://github.com/colinhacks/zod/blob/v4.4.3/packages/zod/src/v4/classic/schemas.ts#L225-L278)

A broad `ProvinceCode` brand can help when the valid set is open. Spain has a
small, known set, so the exact union gives better errors and autocomplete.

Branding the exact union adds friction without more accepted-value precision.
Every valid literal then needs a parser call, helper call, or assertion.

### Template-literal refinement

A template can express a country prefix and lower case:

```ts
type SpanishProvinceCodeShape = `es-${Lowercase<string>}`;
```

It cannot distinguish `es-tf` from `es-xx`. It also accepts an empty suffix.

An alphanumeric character union can model one to three characters. That union
still includes unassigned codes and adds much more compiler work.

Use the template only on the canonical source list. It can catch an upper-case
entry during authoring, while the exact list supplies membership.

### Closed union derived from current maps

The smallest change derives a union from the three existing map keys:

```ts
type SpanishProvinceCode =
  keyof typeof PENINSULAR_PROVINCES | keyof typeof CANARIAS_PROVINCES | keyof typeof IPSI_PROVINCES;
```

This gives exact compile-time membership and good literal authoring. It also
keeps the Province catalog coupled to current tax and shipping groups.

`Object.keys()` then loses the union. A local typed-key helper needs one
assertion, or the Declaration can change its Province maps to arrays.

The array design is cleaner. Province names belong in a catalog, while a Tax
Region and a Service Zone need only readonly arrays of codes.

### Schema-first runtime parser

Zod `z.enum` validates a fixed string set. A const tuple preserves the exact
inferred union.
[Zod enum documentation](https://zod.dev/api#enums)

Zod 4.4.3 converts the enum values into a `Set` and checks membership during
parsing.
[Zod enum implementation](https://github.com/colinhacks/zod/blob/v4.4.3/packages/zod/src/v4/core/schemas.ts#L3196-L3247)

`safeParse` returns a discriminated success or error result. The caller can
handle invalid external data without `try` and `catch`.
[Zod error handling](https://zod.dev/basics#handling-errors)

The repository already catalogs Zod 4.4.3. The Storefront and environment
package already declare it.
[`package.json`](../../package.json),
[`Storefront package`](../../apps/storefront/package.json),
[`Medusa package`](../../apps/medusa/package.json)

A shared Province package must declare Zod directly. It must not import
Medusa's private Zod boundary because the Storefront also needs the parser.

Regular Zod favors method autocomplete. Zod Mini reduces a simple measured
bundle from 5.91 kB to 2.12 kB gzip, with a less discoverable API.
[Zod Mini trade-offs](https://zod.dev/packages/mini#tree-shaking)

Use regular Zod unless a Storefront bundle measurement shows a material cost.
The Province enum itself performs one `Set` lookup.

### Custom parser

A custom parser can use `Set<string>` and return
`SpanishProvinceCode | undefined`. It needs only the canonical list and one
small function.

TypeScript does not prove explicit type predicates. Its documentation states
that an explicit predicate is no safer than a type assertion.
[TypeScript 5.5 predicate note](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html#inferred-type-predicates)

This option has the smallest runtime cost. Zod has better structured errors
and removes the local assertion from the conversion boundary.

### Wrapper object or class

A runtime wrapper can make invalid construction harder. It also changes a
Province from a string into an object.

Every Medusa call, URL, database query, and JSON payload then needs unwrapping.
That cost is larger than the value for a 52-member string set.

### ISO code generation

Generation is the strongest closed-world design when many countries enter the
store. It can produce the const tuple, schema, names, and source date.

ISO offers current lists through its Online Browsing Platform and a downloadable
Country Codes Collection. The downloadable update service is a separate data
pipeline.
[ISO 3166 access](https://www.iso.org/iso-3166-country-codes.html)

One country does not justify a generator, source credentials, update job, and
generated-file review. Revisit generation when a second large country list
arrives.

## Territory Declaration integration

The Province type must flow through the Declaration instead of stopping at the
catalog:

```ts
export type ProvinceTaxRegime<ProvinceCode extends string> = TaxRegime & {
  provinces: readonly ProvinceCode[];
};

export type TerritoryDeclaration<
  Country extends string,
  ProvinceCode extends `${NoInfer<Country>}-${string}`,
> = {
  country: Country;
  currency: string;
  regionName: string;
  stockLocationName: string;
  defaultRegime: TaxRegime;
  provinceRegimes: readonly ProvinceTaxRegime<ProvinceCode>[];
  serviceZones: readonly {
    name: string;
    provinces: readonly ProvinceCode[];
  }[];
};
```

The Spanish Declaration then uses this check:

```ts
export const SPAIN_DECLARATION = {
  // ...
} as const satisfies TerritoryDeclaration<typeof Spain.country, Spain.ProvinceCode>;
```

The toy mechanism test can define its own small Province union. The seed can
remain generic and can widen each code to Medusa's `string` DTO.

This boundary keeps the seed country-independent. It also stops a Spanish
Province typo before a workflow writes a Tax Region or geo zone.

## Runtime edge and error policy

Use `safeParse` at each untrusted entry point. Keep fallback policy outside the
schema.

For a cookie, an invalid value means that the resolver ignores or clears that
cookie. The resolver then continues with geo-IP and the explicit default.

For geo-IP, the provider adapter must map the provider's documented format to
the internal full lower-case format. Then it calls the strict schema.

Do not make the shared parser add `es-`, lower-case every string, or accept a
bare suffix. Those transforms hide provider-contract errors.

If a provider returns official full upper-case ISO values, its adapter can
lower-case that full value before validation. This conversion belongs only in
that adapter.

Log or count parse failures by source. Do not include a raw cookie value in a
Shopper-facing error.

After parsing, the exact union is assignable to Medusa's `string` parameters.
No cast is necessary on writes.

Parse Medusa or database reads again before they re-enter typed Province logic.
The external DTO remains `string | null` and the database column remains text.

## End-to-end limit

This TypeScript design protects code paths that this repository owns. It does
not protect a direct Medusa Admin API call or a manual database edit.

Medusa 2.18.0 validates these external fields only as strings. Full enforcement
there needs an Admin extension, a custom write route, or a database constraint.

A database enum is a poor fit. ISO can add codes, and Medusa owns the schema.
A local check constraint would also create an upgrade boundary on Medusa tables.

Treat the exact TypeScript schema as the application boundary. Add separate
database or Admin controls only when direct invalid writes become an observed
risk.

## Required tests

Add these tests with the type:

1. Compile-time checks accept known literals and reject upper-case, fragments,
   and unknown codes.
2. Runtime checks accept every canonical code.
3. Runtime checks reject non-strings, unknown codes, fragments, and upper-case
   internal values.
4. Every Province in each Territory Declaration passes its country schema.
5. The canonical list has no duplicates.
6. Every canonical code has exactly one display name when names remain.

Do not hide failures with assertions in fixtures. A test literal must use
`satisfies Spain.ProvinceCode` or a typed function parameter.

## Decision summary

Record the decision as an exact, country-specific union with one runtime enum
schema and one plain country subpath. Keep literal authoring free of brands,
casts, and constructors.

Use a template type only as a source-list authoring check. Use Zod at untrusted
edges, and keep provider normalization in provider adapters.

This design has one deliberate trade-off. ISO can add a code before the
repository updates. Monitor the ISO source and make that rejection observable.
