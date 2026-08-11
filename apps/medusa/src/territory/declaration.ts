/** A tax rate and the name that an Operator sees in the admin. */
export type TaxRegime = {
  readonly name: string;
  readonly code: string;
  /** Percent, the way Medusa stores a tax rate. */
  readonly rate: number;
};

/** A regime that applies to selected Provinces rather than to the whole country. */
export type ProvinceTaxRegime<ProvinceCode extends string> = TaxRegime & {
  readonly provinces: readonly ProvinceCode[];
};

export type TerritoryDeclaration<
  Country extends string,
  ProvinceCode extends `${NoInfer<Country>}-${string}`,
> = {
  readonly country: Country;
  readonly currency: string;
  readonly regionName: string;
  readonly stockLocationName: string;
  /** Applies at country level. */
  readonly defaultRegime: TaxRegime;
  /** One Tax Region per selected Province. */
  readonly provinceRegimes: readonly ProvinceTaxRegime<ProvinceCode>[];
  readonly serviceZones: readonly {
    readonly name: string;
    readonly provinces: readonly ProvinceCode[];
  }[];
};
