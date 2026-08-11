# @mze-store/territory

Pure Province identity data and strict input schemas. The package emits ESM for the Storefront and CommonJS for Medusa.

Use a country subpath:

```ts
import * as Spain from "@mze-store/territory/spain";

const result = Spain.provinceCodeSchema.safeParse(input);

for (const province of Spain.provinces) {
  console.log(province.code, province.name);
}
```

`Spain.ProvinceCode` is the exact union inferred from the reviewed Spanish list. Valid literals stay plain strings. The schema does not trim, lower-case, or add a country prefix.

The package root exports `createProvinceCodeSchema`, `ProvinceList`, and `ProvinceCodeOf` for new country modules and small fixtures. A country module must record its official source and review date. Keep tax regimes and Service Zones outside this package.

See [ADR-0022](../../docs/adr/0022-province-code-is-a-closed-reviewed-union.md) for the decision and update policy.
