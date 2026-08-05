/**
 * The Spanish territory model: one Region, two tax regimes, two Service Zones.
 *
 * Canarias cannot be a Region of its own. It shares the country code `es` with
 * the peninsula, and a country belongs to exactly one Region. A Region varies
 * two things, currency and payment methods. Both are the same in Canarias and
 * on the peninsula. Tax and shipping are what differ, and each one resolves at
 * Province granularity. See ADR-0005.
 *
 * Province codes are ISO 3166-2 in lower case. Medusa stores them in this form
 * on Tax Regions and geo zones. The Store API accepts them in this form as
 * `province`.
 */

/** ISO 3166-1 alpha-2, lower-cased the way Medusa stores country codes. */
export const SPAIN = "es";

/** What a Spanish Shopper pays in. One Region, one currency. */
export const CURRENCY = "eur";

/**
 * A tax regime: the rate to charge, and the name an Operator sees in the admin.
 *
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

/** The rate for every Spanish Province that no Province regime names. */
export const PENINSULAR_VAT: TaxRegime = {
  name: "IVA general",
  code: "iva-general",
  rate: 21,
};

/** The two Canarian Provinces. IGIC applies to both. */
export const CANARIAS_PROVINCES = {
  "es-gc": "Las Palmas",
  "es-tf": "Santa Cruz de Tenerife",
} as const;

export const CANARIAS_IGIC: ProvinceTaxRegime = {
  name: "IGIC tipo general",
  code: "igic-general",
  rate: 7,
  provinces: CANARIAS_PROVINCES,
};

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
export const PROVINCE_TAX_REGIMES: ProvinceTaxRegime[] = [CANARIAS_IGIC];

/**
 * Ceuta and Melilla, which use IPSI. This is a third regime, and the seed
 * leaves it out on purpose. No rate for IPSI is confirmed, and the shop does
 * not ship there yet. Until a regime exists, both Provinces use the
 * country-level Tax Region and pay peninsular VAT.
 */
export const IPSI_PROVINCES = {
  "es-ce": "Ceuta",
  "es-ml": "Melilla",
} as const;

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
export const PENINSULAR_PROVINCES = {
  "es-a": "Alicante",
  "es-ab": "Albacete",
  "es-al": "Almería",
  "es-av": "Ávila",
  "es-b": "Barcelona",
  "es-ba": "Badajoz",
  "es-bi": "Bizkaia",
  "es-bu": "Burgos",
  "es-c": "A Coruña",
  "es-ca": "Cádiz",
  "es-cc": "Cáceres",
  "es-co": "Córdoba",
  "es-cr": "Ciudad Real",
  "es-cs": "Castellón",
  "es-cu": "Cuenca",
  "es-gi": "Girona",
  "es-gr": "Granada",
  "es-gu": "Guadalajara",
  "es-h": "Huelva",
  "es-hu": "Huesca",
  "es-j": "Jaén",
  "es-l": "Lleida",
  "es-le": "León",
  "es-lo": "La Rioja",
  "es-lu": "Lugo",
  "es-m": "Madrid",
  "es-ma": "Málaga",
  "es-mu": "Murcia",
  "es-na": "Navarra",
  "es-o": "Asturias",
  "es-or": "Ourense",
  "es-p": "Palencia",
  "es-pm": "Baleares",
  "es-po": "Pontevedra",
  "es-s": "Cantabria",
  "es-sa": "Salamanca",
  "es-se": "Sevilla",
  "es-sg": "Segovia",
  "es-so": "Soria",
  "es-ss": "Gipuzkoa",
  "es-t": "Tarragona",
  "es-te": "Teruel",
  "es-to": "Toledo",
  "es-v": "Valencia",
  "es-va": "Valladolid",
  "es-vi": "Álava",
  "es-z": "Zaragoza",
  "es-za": "Zamora",
} as const;
