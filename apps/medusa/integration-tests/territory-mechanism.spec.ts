import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  createProvinceCodeSchema,
  type ProvinceCodeOf,
  type ProvinceList,
} from "@mze-store/territory";
import type { TerritoryDeclaration } from "~/territory/declaration";
import { seedTerritory } from "~/territory/seed";

jest.setTimeout(120 * 1000);

const TOY_PROVINCES = [{ code: "pt-30", name: "Madeira" }] as const satisfies ProvinceList<"pt">;

const toyProvinceCodeSchema = createProvinceCodeSchema("pt", TOY_PROVINCES);
type ToyProvinceCode = ProvinceCodeOf<typeof TOY_PROVINCES>;

const TOY_DECLARATION = {
  country: "pt",
  currency: "eur",
  regionName: "Toy Portugal",
  stockLocationName: "Toy stock location",
  defaultRegime: {
    name: "Toy standard tax",
    code: "toy-standard",
    rate: 23,
  },
  provinceRegimes: [
    {
      name: "Toy Madeira tax",
      code: "toy-madeira",
      rate: 22,
      provinces: ["pt-30"],
    },
  ],
  serviceZones: [{ name: "Toy Madeira service", provinces: ["pt-30"] }],
} as const satisfies TerritoryDeclaration<"pt", ToyProvinceCode>;

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    beforeAll(async () => {
      await seedTerritory(getContainer(), TOY_DECLARATION);
    });

    const graph = async <T = Record<string, any>>(
      entity: string,
      fields: string[],
      filters?: Record<string, unknown>,
    ): Promise<T[]> => {
      const query = (getContainer() as MedusaContainer).resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({ entity, fields, filters });
      return data as T[];
    };

    it("uses canonical Province codes throughout the toy Declaration", () => {
      const declaredProvinces = [
        ...TOY_DECLARATION.provinceRegimes.flatMap(({ provinces }) => provinces),
        ...TOY_DECLARATION.serviceZones.flatMap(({ provinces }) => provinces),
      ];

      for (const province of declaredProvinces) {
        expect(toyProvinceCodeSchema.safeParse(province)).toMatchObject({ success: true });
      }
    });

    it("applies the Region, Tax Regions, and Service Zone from a non-Spanish Declaration", async () => {
      const regions = await graph("region", ["name", "currency_code", "countries.iso_2"]);
      const region = regions.find((candidate) =>
        candidate.countries?.some(
          (country: { iso_2: string }) => country.iso_2 === TOY_DECLARATION.country,
        ),
      );

      expect(region).toMatchObject({
        name: TOY_DECLARATION.regionName,
        currency_code: TOY_DECLARATION.currency,
      });

      const taxRegions = await graph("tax_region", ["province_code"], {
        country_code: TOY_DECLARATION.country,
      });

      expect(new Set(taxRegions.map(({ province_code }) => province_code))).toEqual(
        new Set([null, ...TOY_DECLARATION.provinceRegimes[0]!.provinces]),
      );

      const serviceZones = await graph("service_zone", [
        "name",
        "geo_zones.country_code",
        "geo_zones.province_code",
      ]);

      const serviceZone = serviceZones.find(
        ({ name }) => name === TOY_DECLARATION.serviceZones[0]!.name,
      );

      expect(serviceZone).toMatchObject({
        name: TOY_DECLARATION.serviceZones[0]!.name,
        geo_zones: [
          {
            country_code: TOY_DECLARATION.country,
            province_code: TOY_DECLARATION.serviceZones[0]!.provinces[0],
          },
        ],
      });
    });
  },
});
