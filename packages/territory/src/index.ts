import { z } from "zod";

type LowercaseLetter =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";

/** The lower-case representation of an ISO 3166-1 alpha-2 country code. */
export type CountryCode = `${LowercaseLetter}${LowercaseLetter}`;

/** One Province and its canonical reference name. */
export type Province<Country extends CountryCode = CountryCode> = Readonly<{
  code: `${Country}-${Lowercase<string>}`;
  name: string;
}>;

/** A non-empty set of Provinces for one country. */
export type ProvinceList<Country extends CountryCode> = readonly [
  Province<Country>,
  ...Province<Country>[],
];

/** The exact union of codes in a Province list. */
export type ProvinceCodeOf<Provinces extends readonly Readonly<{ code: string }>[]> =
  Provinces[number]["code"];

type ProvinceCodeEnum<Code extends string> = Readonly<Record<Code, Code>>;

const countryCodePattern = /^[a-z]{2}$/u;
const provinceCodePattern = /^[a-z]{2}-[a-z0-9]{1,3}$/u;

/**
 * Builds the strict input schema for one country's reviewed Province list.
 * It also checks reference data when the country module first loads.
 */
export function createProvinceCodeSchema<
  const Country extends CountryCode,
  const Provinces extends ProvinceList<Country>,
>(country: Country, provinces: Provinces) {
  if (!countryCodePattern.test(country)) {
    throw new Error(`Invalid country code: ${country}`);
  }

  if (provinces.length === 0) {
    throw new Error(`The Province list for ${country} must not be empty.`);
  }

  const codes = new Set<string>();

  for (const province of provinces) {
    if (!provinceCodePattern.test(province.code) || !province.code.startsWith(`${country}-`)) {
      throw new Error(`Invalid Province code for ${country}: ${province.code}`);
    }

    if (codes.has(province.code)) {
      throw new Error(`Duplicate Province code for ${country}: ${province.code}`);
    }

    if (province.name.trim().length === 0) {
      throw new Error(`Province ${province.code} must have a name.`);
    }

    codes.add(province.code);
  }

  const values = Object.fromEntries(provinces.map(({ code }) => [code, code])) as ProvinceCodeEnum<
    ProvinceCodeOf<Provinces>
  >;

  return z.enum(values);
}
