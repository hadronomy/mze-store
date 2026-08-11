import type { z } from "zod";
import { createProvinceCodeSchema, type ProvinceList } from "./index";

/** ISO 3166-1 alpha-2 in the application's canonical form. */
export const country = "es";

/**
 * Province-level ISO 3166-2 entries for Spain.
 *
 * Names are canonical Spanish reference names. User-facing localization is a
 * separate Storefront concern keyed by ProvinceCode.
 *
 * Source: ISO 3166 Online Browsing Platform. Reviewed 2026-08-11.
 */
export const provinces = [
  { code: "es-a", name: "Alicante" },
  { code: "es-ab", name: "Albacete" },
  { code: "es-al", name: "Almería" },
  { code: "es-av", name: "Ávila" },
  { code: "es-b", name: "Barcelona" },
  { code: "es-ba", name: "Badajoz" },
  { code: "es-bi", name: "Bizkaia" },
  { code: "es-bu", name: "Burgos" },
  { code: "es-c", name: "A Coruña" },
  { code: "es-ca", name: "Cádiz" },
  { code: "es-cc", name: "Cáceres" },
  { code: "es-ce", name: "Ceuta" },
  { code: "es-co", name: "Córdoba" },
  { code: "es-cr", name: "Ciudad Real" },
  { code: "es-cs", name: "Castellón" },
  { code: "es-cu", name: "Cuenca" },
  { code: "es-gc", name: "Las Palmas" },
  { code: "es-gi", name: "Girona" },
  { code: "es-gr", name: "Granada" },
  { code: "es-gu", name: "Guadalajara" },
  { code: "es-h", name: "Huelva" },
  { code: "es-hu", name: "Huesca" },
  { code: "es-j", name: "Jaén" },
  { code: "es-l", name: "Lleida" },
  { code: "es-le", name: "León" },
  { code: "es-lo", name: "La Rioja" },
  { code: "es-lu", name: "Lugo" },
  { code: "es-m", name: "Madrid" },
  { code: "es-ma", name: "Málaga" },
  { code: "es-ml", name: "Melilla" },
  { code: "es-mu", name: "Murcia" },
  { code: "es-na", name: "Navarra" },
  { code: "es-o", name: "Asturias" },
  { code: "es-or", name: "Ourense" },
  { code: "es-p", name: "Palencia" },
  { code: "es-pm", name: "Baleares" },
  { code: "es-po", name: "Pontevedra" },
  { code: "es-s", name: "Cantabria" },
  { code: "es-sa", name: "Salamanca" },
  { code: "es-se", name: "Sevilla" },
  { code: "es-sg", name: "Segovia" },
  { code: "es-so", name: "Soria" },
  { code: "es-ss", name: "Gipuzkoa" },
  { code: "es-t", name: "Tarragona" },
  { code: "es-te", name: "Teruel" },
  { code: "es-tf", name: "Santa Cruz de Tenerife" },
  { code: "es-to", name: "Toledo" },
  { code: "es-v", name: "Valencia" },
  { code: "es-va", name: "Valladolid" },
  { code: "es-vi", name: "Álava" },
  { code: "es-z", name: "Zaragoza" },
  { code: "es-za", name: "Zamora" },
] as const satisfies ProvinceList<typeof country>;

export const provinceCodeSchema = createProvinceCodeSchema(country, provinces);

export type Province = (typeof provinces)[number];
export type ProvinceCode = z.infer<typeof provinceCodeSchema>;
