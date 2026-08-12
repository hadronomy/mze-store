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

type TerritoryQueryFilters = { readonly country_code?: string };
type RegionQueryRow = {
  readonly countries?: ReadonlyArray<{ readonly iso_2?: string | null } | null>;
  readonly currency_code?: string;
  readonly name?: string;
};
type TaxRegionQueryRow = { readonly province_code?: string | null };
type ServiceZoneQueryRow = {
  readonly geo_zones: ReadonlyArray<{
    readonly country_code?: string | null;
    readonly province_code?: string | null;
  }>;
  readonly name?: string;
};
type TerritoryQueryRow = RegionQueryRow | TaxRegionQueryRow | ServiceZoneQueryRow;

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

    async function graph(entity: "region", fields: string[]): Promise<RegionQueryRow[]>;
    async function graph(
      entity: "tax_region",
      fields: string[],
      filters?: TerritoryQueryFilters,
    ): Promise<TaxRegionQueryRow[]>;
    async function graph(entity: "service_zone", fields: string[]): Promise<ServiceZoneQueryRow[]>;
    async function graph(
      entity: "region" | "tax_region" | "service_zone",
      fields: string[],
      filters?: TerritoryQueryFilters,
    ): Promise<TerritoryQueryRow[]> {
      const query = (getContainer() as MedusaContainer).resolve(ContainerRegistrationKeys.QUERY);

      switch (entity) {
        case "region":
          return (await query.graph({ entity, fields })).data;
        case "tax_region":
          return (await query.graph({ entity, fields, filters })).data;
        case "service_zone":
          return (await query.graph({ entity, fields })).data;
      }
    }

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
        candidate.countries?.some((country) => country?.iso_2 === TOY_DECLARATION.country),
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
