import { country as SPAIN, type ProvinceCode } from "@mze-store/territory/spain";
import type { ProvinceTaxRegime, TaxRegime, TerritoryDeclaration } from "./declaration";

/**
 * The Spanish territory model: one Region, two tax regimes, two Service Zones.
 *
 * Canarias cannot be a Region of its own. It shares the country code `es` with
 * the peninsula, and a country belongs to exactly one Region. A Region varies
 * two things, currency and payment methods. Both are the same in Canarias and
 * on the peninsula. Tax and shipping are what differ, and each one resolves at
 * Province granularity. See ADR-0005.
 */

export { SPAIN };

/** What a Spanish Shopper pays in. One Region, one currency. */
export const CURRENCY = "eur";

/**
 * These rates start a new database. They are not the policy. The Tax Region
 * row is authoritative, an Operator edits it in the admin, and nothing here is
 * read at run time. A rate changes by law on a date that a release cannot
 * predict, so the change belongs in a form and not in a deploy. See ADR-0019.
 *
 * CAUTION: Before a Shopper sees a price, a gestor must approve the rate that
 * the admin shows. EU law puts tax in the displayed price. A wrong rate is
 * therefore a wrong price for the Shopper. You cannot correct it in the
 * accounts later.
 */

/** The rate for every Spanish Province that no Province regime names. */
export const PENINSULAR_VAT: TaxRegime = {
  name: "IVA general",
  code: "iva-general",
  rate: 21,
};

/** The two Canarian Provinces. IGIC applies to both. */
export const CANARIAS_PROVINCES = ["es-gc", "es-tf"] as const satisfies readonly ProvinceCode[];

export const CANARIAS_IGIC = {
  name: "IGIC tipo general",
  code: "igic-general",
  rate: 7,
  provinces: CANARIAS_PROVINCES,
} as const satisfies ProvinceTaxRegime<ProvinceCode>;

/**
 * Every regime that resolves at Province granularity. Each regime gets one Tax
 * Region for each of its Provinces. Every other Province uses PENINSULAR_VAT.
 *
 * A new regime is one entry in this list. It needs no change to a data model
 * and no migration, which is what ADR-0005 claims about Ceuta and Melilla.
 *
 * Shipping is a separate decision, because tax and shipping vary
 * independently. The entry gives a new regime its Tax Regions. An Operator
 * adds the same Provinces to a Service Zone in the admin, under
 * Settings → Locations & Shipping. The seed never edits a zone that exists.
 */
export const PROVINCE_TAX_REGIMES = [
  CANARIAS_IGIC,
] as const satisfies readonly ProvinceTaxRegime<ProvinceCode>[];

/**
 * Ceuta and Melilla, which use IPSI. This is a third regime, and the seed
 * leaves it out on purpose. No rate for IPSI is confirmed, and the shop does
 * not ship there yet. Until a regime exists, both Provinces use the
 * country-level Tax Region and pay peninsular VAT.
 */
export const IPSI_PROVINCES = ["es-ce", "es-ml"] as const satisfies readonly ProvinceCode[];

/**
 * Every Spanish Province under peninsular VAT, by ISO 3166-2 code.
 *
 * Tax does not need this list. The country-level Tax Region covers each of
 * these Provinces by default. Shipping does need it. A Service Zone scoped to
 * country `es` covers Canarias too, which removes the split that this model
 * exists to make. The peninsular zone therefore names each Province.
 *
 * Baleares (`es-pm`) is in this list. It is not the peninsula, but it has the
 * same tax regime. Its shipping is a later problem than this seed.
 */
export const PENINSULAR_PROVINCES = [
  "es-a",
  "es-ab",
  "es-al",
  "es-av",
  "es-b",
  "es-ba",
  "es-bi",
  "es-bu",
  "es-c",
  "es-ca",
  "es-cc",
  "es-co",
  "es-cr",
  "es-cs",
  "es-cu",
  "es-gi",
  "es-gr",
  "es-gu",
  "es-h",
  "es-hu",
  "es-j",
  "es-l",
  "es-le",
  "es-lo",
  "es-lu",
  "es-m",
  "es-ma",
  "es-mu",
  "es-na",
  "es-o",
  "es-or",
  "es-p",
  "es-pm",
  "es-po",
  "es-s",
  "es-sa",
  "es-se",
  "es-sg",
  "es-so",
  "es-ss",
  "es-t",
  "es-te",
  "es-to",
  "es-v",
  "es-va",
  "es-vi",
  "es-z",
  "es-za",
] as const satisfies readonly ProvinceCode[];

/** The starting state for the Spanish Region, Tax Regions, and Service Zones. */
export const SPAIN_DECLARATION = {
  country: SPAIN,
  currency: CURRENCY,
  regionName: "Spain",
  stockLocationName: "Canarias",
  defaultRegime: PENINSULAR_VAT,
  provinceRegimes: PROVINCE_TAX_REGIMES,
  serviceZones: [
    { name: "Peninsula and Baleares", provinces: PENINSULAR_PROVINCES },
    { name: "Canarias", provinces: CANARIAS_PROVINCES },
  ],
} as const satisfies TerritoryDeclaration<typeof SPAIN, ProvinceCode>;
