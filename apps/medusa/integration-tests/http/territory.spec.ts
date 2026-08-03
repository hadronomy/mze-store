import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { updateServiceZonesWorkflow } from "@medusajs/medusa/core-flows";
import {
  CANARIAS_IGIC,
  CANARIAS_PROVINCES,
  CURRENCY,
  IPSI_PROVINCES,
  PENINSULAR_PROVINCES,
  PENINSULAR_VAT,
  SPAIN,
} from "../../src/territory/spain";
import { seedSpanishTerritory, type SeededTerritory } from "../../src/territory/seed";
import {
  PROBE_OPTION,
  PROBE_PRICE,
  seedTerritoryProbe,
  type SeededProbe,
} from "../../src/territory/probe";
import { signInAsOperator } from "../utils/operator";

jest.setTimeout(120 * 1000);

/** Madrid, a Province that the seed leaves to the country-level Tax Region. */
const PENINSULAR_PROVINCE = "es-m";
/** Santa Cruz de Tenerife, a Province with a Tax Region of its own. */
const CANARIAN_PROVINCE = "es-tf";

/**
 * The two prices that a freshly seeded database returns, written out and not
 * derived from the rates that the seed writes. A test that repeats the
 * arithmetic of the seed also repeats a typo in it.
 *
 * These two numbers say nothing about a live store. A rate is authoritative in
 * the database, an Operator edits it in the admin, and this suite never reads
 * that database. What the assertion protects is the shape of the model: two
 * Provinces, two regimes, one stored price.
 */
const PENINSULAR_PRICE = 121;
const CANARIAN_PRICE = 107;

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let seeded: SeededTerritory;
    let probe: SeededProbe;

    // Both seeds run once, before the runner makes a snapshot of the database.
    // Each test therefore starts from the same seeded state, and no test can
    // affect another one.
    //
    // The probe is a fixture and the territory is policy, which is why they are
    // two calls. Only this suite and a development database get the probe.
    beforeAll(async () => {
      seeded = await seedSpanishTerritory(getContainer());
      probe = await seedTerritoryProbe(getContainer(), seeded);
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

    const priceIn = async (province: string, productId = probe.productId) => {
      const response = await api.get(
        `/store/products/${productId}` +
          `?region_id=${seeded.regionId}&country_code=${SPAIN}&province=${province}` +
          `&fields=*variants.calculated_price`,
        { headers: { "x-publishable-api-key": probe.publishableKey } },
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
          expect(spanish[0]!.currency_code).toEqual(CURRENCY);
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
          // A country geo zone covers Canarias too, and that removes the split
          // that this model exists to make.
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
        // The assertion that phase 2 exists to make. If this test fails,
        // ADR-0005 is wrong, and the storefront cannot use this territory model.
        it("shows a Canarian Shopper a different, correct tax-inclusive price from a peninsular one", async () => {
          const canarian = await priceIn(CANARIAN_PROVINCE);
          const peninsular = await priceIn(PENINSULAR_PROVINCE);

          expect(canarian.calculated_amount_with_tax).toBeCloseTo(CANARIAN_PRICE, 2);
          expect(peninsular.calculated_amount_with_tax).toBeCloseTo(PENINSULAR_PRICE, 2);

          // The Variant, the Region, and the stored price are the same. Only
          // the tax changed.
          expect(canarian.calculated_amount).toEqual(PROBE_PRICE);
          expect(peninsular.calculated_amount).toEqual(PROBE_PRICE);
        });

        // Nobody wants this price. The test records what an unseeded Province
        // does today, so that a new IPSI regime must come here and change it.
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
              shipping_profile_id: probe.shippingProfileId,
              sales_channels: [{ id: seeded.salesChannelId }],
              options: [{ title: PROBE_OPTION.title, values: [PROBE_OPTION.value] }],
              variants: [
                {
                  title: PROBE_OPTION.value,
                  options: { [PROBE_OPTION.title]: PROBE_OPTION.value },
                  manage_inventory: false,
                  prices: [{ amount: PROBE_PRICE, currency_code: CURRENCY }],
                },
              ],
            },
            operator,
          );

          const productId = created.data.product.id;

          // The admin shows an Operator one stored price, without tax. The
          // Store API computes the two prices that a Shopper sees, and the two
          // reads that follow therefore go through it.
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
          const probeAgain = await seedTerritoryProbe(getContainer(), again);

          expect(await count()).toEqual(before);
          expect(again).toEqual(seeded);
          expect(probeAgain).toEqual(probe);
        });

        // What a new tax regime needs: its Provinces reach an existing Service
        // Zone. A seed that matched on the name of the zone alone would leave
        // them with no shipping, and no re-run could repair it.
        it("puts back a Province that a Service Zone lost", async () => {
          const zoneWith = async (province: string) => {
            const zones = await graph("service_zone", [
              "id",
              "geo_zones.id",
              "geo_zones.province_code",
            ]);

            return zones.find((zone) =>
              zone.geo_zones.some(
                (geoZone: { province_code: string }) => geoZone.province_code === province,
              ),
            );
          };

          const canarian = (await zoneWith(CANARIAN_PROVINCE))!;
          const kept = canarian.geo_zones.filter(
            (geoZone: { province_code: string }) => geoZone.province_code !== CANARIAN_PROVINCE,
          );

          await updateServiceZonesWorkflow(getContainer()).run({
            input: {
              selector: { id: canarian.id },
              update: { geo_zones: kept.map((geoZone: { id: string }) => ({ id: geoZone.id })) },
            },
          });

          expect(await zoneWith(CANARIAN_PROVINCE)).toBeUndefined();

          await seedSpanishTerritory(getContainer());

          const repaired = await zoneWith(CANARIAN_PROVINCE);

          expect(repaired?.id).toEqual(canarian.id);
          expect(repaired!.geo_zones).toHaveLength(canarian.geo_zones.length);
        });
      });
    });
  },
});
