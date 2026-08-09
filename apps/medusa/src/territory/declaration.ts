/** A tax rate and the name that an Operator sees in the admin. */
export type TaxRegime = {
  name: string;
  code: string;
  /** Percent, the way Medusa stores a tax rate. */
  rate: number;
};

/** A regime that applies to named Provinces rather than to the whole country. */
export type ProvinceTaxRegime = TaxRegime & {
  provinces: Record<string, string>;
};

export type TerritoryDeclaration = {
  /** ISO 3166-1 alpha-2, lower case. */
  country: string;
  currency: string;
  regionName: string;
  stockLocationName: string;
  /** Applies at country level. */
  defaultRegime: TaxRegime;
  /** One Tax Region per named Province. */
  provinceRegimes: ProvinceTaxRegime[];
  serviceZones: { name: string; provinces: string[] }[];
};
