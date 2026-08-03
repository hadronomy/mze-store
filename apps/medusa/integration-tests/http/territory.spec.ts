import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import {
  CANARIAS_IGIC,
  CANARIAS_PROVINCES,
  IPSI_PROVINCES,
  PENINSULAR_PROVINCES,
  PENINSULAR_VAT,
  SPAIN,
} from "../../src/territory/spain";
import { PROBE_PRICE, seedSpanishTerritory, type SeededTerritory } from "../../src/territory/seed";
import { signInAsOperator } from "../utils/operator";

jest.setTimeout(120 * 1000);

/** A Province the seed leaves to the country-level Tax Region: Madrid. */
const PENINSULAR_PROVINCE = "es-m";
/** Santa Cruz de Tenerife — a Province with a Tax Region of its own. */
const CANARIAN_PROVINCE = "es-tf";

/**
 * The figures on the shelf, written out rather than derived from the rates the
 * seed writes — a test that recomputes the seed's own arithmetic would pass a
 * typo straight through. Changing a rate has to change these too, deliberately,
 * which is the point: no rate reaches a Shopper without someone editing the
 * number they will be charged.
 */
const PENINSULAR_PRICE = 121;
const CANARIAN_PRICE = 107;

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let seeded: SeededTerritory;

    // Seeded once, before the runner snapshots the database, so every test
    // below starts from the same seeded state and none can pollute another.
    beforeAll(async () => {
      seeded = await seedSpanishTerritory(getContainer());
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

    const priceIn = async (province: string, productId = seeded.productId) => {
      const response = await api.get(
        `/store/products/${productId}` +
          `?region_id=${seeded.regionId}&country_code=${SPAIN}&province=${province}` +
          `&fields=*variants.calculated_price`,
        { headers: { "x-publishable-api-key": seeded.publishableKey } },
      );

      return response.data.product.variants[0].calculated_price;
    };

    describe("Spanish territory", () => {
      describe("the model", () => {
        it("carries exactly one Region for Spain, with its currency and payment providers", async () => {
          const regions = await graph("region", [
            "id",
            "currency_code",
            "countries.iso_2",
            "payment_providers.id",
          ]);

          const spanish = regions.filter((region) =>
            region.countries?.some((country: { iso_2: string }) => country.iso_2 === SPAIN),
          );

          expect(spanish).toHaveLength(1);
          expect(spanish[0]!.currency_code).toEqual("eur");
          expect(spanish[0]!.payment_providers.length).toBeGreaterThan(0);
        });

        it("carries the peninsular VAT rate on the country and IGIC on each Canarian Province", async () => {
          const taxRegions = await graph(
            "tax_region",
            ["province_code", "tax_rates.rate", "tax_rates.is_default"],
            { country_code: SPAIN },
          );

          const rateOf = (provinceCode: string | null) =>
            taxRegions
              .find((region) => region.province_code === provinceCode)
              ?.tax_rates?.find((rate: { is_default: boolean }) => rate.is_default)?.rate;

          expect(rateOf(null)).toEqual(PENINSULAR_VAT.rate);
          for (const province of Object.keys(CANARIAS_PROVINCES)) {
            expect(rateOf(province)).toEqual(CANARIAS_IGIC.rate);
          }
        });

        it("leaves Ceuta and Melilla unseeded", async () => {
          const taxRegions = await graph("tax_region", ["province_code"], { country_code: SPAIN });

          const provinces = taxRegions.map((region) => region.province_code);

          for (const province of Object.keys(IPSI_PROVINCES)) {
            expect(provinces).not.toContain(province);
          }
        });

        it("scopes every Service Zone to Provinces, keeping Canarias apart from the peninsula", async () => {
          const zones = await graph("service_zone", [
            "name",
            "geo_zones.type",
            "geo_zones.province_code",
          ]);

          const provincesOf = (zone: (typeof zones)[number]) =>
            zone.geo_zones.map((geoZone: { province_code: string }) => geoZone.province_code);
          const types = zones.flatMap((zone) =>
            zone.geo_zones.map((geoZone: { type: string }) => geoZone.type),
          );

          expect(zones).toHaveLength(2);
          // A country geo zone would cover Canarias too, collapsing the split
          // this whole model exists to make.
          expect(new Set(types)).toEqual(new Set(["province"]));

          const canarian = zones.find((zone) => provincesOf(zone).includes(CANARIAN_PROVINCE))!;
          const peninsular = zones.find((zone) => zone !== canarian)!;

          expect(new Set(provincesOf(canarian))).toEqual(new Set(Object.keys(CANARIAS_PROVINCES)));
          expect(new Set(provincesOf(peninsular))).toEqual(
            new Set(Object.keys(PENINSULAR_PROVINCES)),
          );
        });
      });

      describe("prices", () => {
        // The assertion phase 2 exists to make. If this fails, ADR-0005 is
        // wrong and the storefront's whole territory story goes with it.
        it("shows a Canarian Shopper a different, correct tax-inclusive price from a peninsular one", async () => {
          const canarian = await priceIn(CANARIAN_PROVINCE);
          const peninsular = await priceIn(PENINSULAR_PROVINCE);

          expect(canarian.calculated_amount_with_tax).toBeCloseTo(CANARIAN_PRICE, 2);
          expect(peninsular.calculated_amount_with_tax).toBeCloseTo(PENINSULAR_PRICE, 2);

          // Same Variant, same Region, same stored price — only the tax moved.
          expect(canarian.calculated_amount).toEqual(PROBE_PRICE);
          expect(peninsular.calculated_amount).toEqual(PROBE_PRICE);
        });

        // Not a price anyone wants: it records what the unseeded case does
        // today, so that seeding IPSI has to come here and say so.
        it("charges peninsular VAT in Ceuta until IPSI is modelled", async () => {
          const ceuta = await priceIn("es-ce");

          expect(ceuta.calculated_amount_with_tax).toBeCloseTo(PENINSULAR_PRICE, 2);
        });
      });

      describe("an Operator", () => {
        it("creates a Variant in the admin and reads both prices back", async () => {
          const operator = await signInAsOperator(getContainer(), api, {
            email: "operator@mze.store",
            password: "supersecret",
          });

          const created = await api.post(
            "/admin/products",
            {
              title: "Operator probe",
              status: "published",
              shipping_profile_id: seeded.shippingProfileId,
              sales_channels: [{ id: seeded.salesChannelId }],
              options: [{ title: "Size", values: ["One size"] }],
              variants: [
                {
                  title: "One size",
                  options: { Size: "One size" },
                  manage_inventory: false,
                  prices: [{ amount: PROBE_PRICE, currency_code: "eur" }],
                },
              ],
            },
            operator,
          );

          const productId = created.data.product.id;

          // What the admin itself shows an Operator: the one stored price,
          // tax exclusive. The two figures a Shopper sees are the Store API's
          // to compute, which is why the reads below go through it.
          const admin = await api.get(
            `/admin/products/${productId}?fields=*variants.prices`,
            operator,
          );

          expect(admin.data.product.variants[0].prices[0].amount).toEqual(PROBE_PRICE);

          const canarian = await priceIn(CANARIAN_PROVINCE, productId);
          const peninsular = await priceIn(PENINSULAR_PROVINCE, productId);

          expect(canarian.calculated_amount_with_tax).toBeCloseTo(CANARIAN_PRICE, 2);
          expect(peninsular.calculated_amount_with_tax).toBeCloseTo(PENINSULAR_PRICE, 2);
        });
      });

      describe("running the seed twice", () => {
        it("creates no second Region, Tax Region, or Service Zone", async () => {
          const count = async () => ({
            regions: (await graph("region", ["id"])).length,
            taxRegions: (await graph("tax_region", ["id"])).length,
            serviceZones: (await graph("service_zone", ["id"])).length,
            geoZones: (await graph("geo_zone", ["id"])).length,
            salesChannels: (await graph("sales_channel", ["id"])).length,
            stockLocations: (await graph("stock_location", ["id"])).length,
            products: (await graph("product", ["id"])).length,
            apiKeys: (await graph("api_key", ["id"])).length,
          });

          const before = await count();
          const again = await seedSpanishTerritory(getContainer());

          expect(await count()).toEqual(before);
          expect(again).toEqual(seeded);
        });
      });
    });
  },
});
