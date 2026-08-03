/**
 * The Spanish territory model: one Region, two tax regimes, two Service Zones.
 *
 * Canarias cannot be its own Region — it shares country code `es` with the
 * peninsula, and currency and payment methods, the two things a Region exists
 * to vary, are identical across both. What differs is tax and shipping, and
 * both resolve at Province granularity. See ADR-0005.
 *
 * Province codes are ISO 3166-2, lower-cased: the form Medusa stores on Tax
 * Regions and geo zones, and the form the Store API accepts as `province`.
 */

/** ISO 3166-1 alpha-2, lower-cased the way Medusa stores country codes. */
export const SPAIN = "es";

/**
 * A tax regime: the rate to charge, and what an Operator sees against it in
 * the admin.
 *
 * The rates below are UNCONFIRMED. A gestor has to sign each one off before a
 * Shopper sees a price computed from it — EU law puts tax in the displayed
 * price, so a wrong rate is a wrong price on the shelf, not an accounting
 * correction later.
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

/** What every Spanish Province is charged unless a Province regime names it. */
export const PENINSULAR_VAT: TaxRegime = {
  name: "IVA general",
  code: "iva-general",
  rate: 21,
};

/** The two Canarian provinces, both under IGIC. */
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
 * Every regime that resolves at Province granularity. Each one gets a Tax
 * Region per Province; everything unnamed falls through to PENINSULAR_VAT.
 *
 * Adding a regime is an entry here and nothing else — which is the whole
 * claim ADR-0005 makes about Ceuta and Melilla.
 */
export const PROVINCE_TAX_REGIMES: ProvinceTaxRegime[] = [CANARIAS_IGIC];

/**
 * Ceuta and Melilla, which use IPSI — a third regime, and deliberately not one
 * of the above. No rate for it is confirmed and nothing ships there yet, so
 * both Provinces fall through to the country-level Tax Region and are charged
 * peninsular VAT in the meantime.
 */
export const IPSI_PROVINCES = {
  "es-ce": "Ceuta",
  "es-ml": "Melilla",
} as const;

/**
 * Every Spanish province under peninsular VAT, by ISO 3166-2 code.
 *
 * Tax does not need this list — the country-level Tax Region covers each of
 * them by default. Shipping does: a Service Zone scoped to country `es` would
 * swallow Canarias and collapse the split the model exists to make, so the
 * peninsular zone has to name its Provinces one by one.
 *
 * Baleares (`es-pm`) rides here. It is not the peninsula, but it is the same
 * tax regime, and its shipping is a later problem than this seed.
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
