import { z } from "@medusajs/framework/zod";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { TAX_RATE_AUDIT_MODULE } from "~/modules/tax-rate-audit";
import { TaxRateChangesResponseSchema } from "~/modules/tax-rate-audit/schema";
import type { TaxRateAuditModule } from "~/modules/tax-rate-audit/service";
import type { TerritoryDeclaration } from "~/territory/declaration";
import { seedTerritory } from "~/territory/seed";
import { signInAsOperator } from "../utils/operator";

jest.setTimeout(120 * 1000);

const TaxRegionResponseSchema = z.object({
  tax_region: z.object({ id: z.string() }),
});

const TaxRateResponseSchema = z.object({
  tax_rate: z.object({ id: z.string() }),
});

const TaxRateListResponseSchema = z.object({
  tax_rates: z.array(
    z.object({
      id: z.string(),
      rate: z.number().nullable(),
    }),
  ),
});

const TOY_DECLARATION = {
  country: "pt",
  currency: "eur",
  regionName: "Audit Portugal",
  stockLocationName: "Audit stock location",
  defaultRegime: {
    name: "Mainland VAT",
    code: "vat",
    rate: 23,
  },
  provinceRegimes: [
    {
      name: "Madeira VAT",
      code: "vat-madeira",
      rate: 22,
      provinces: ["pt-30"],
    },
  ],
  serviceZones: [{ name: "Audit Madeira", provinces: ["pt-30"] }],
} as const satisfies TerritoryDeclaration<"pt", "pt-30">;

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: function taxRateAuditTestSuite({ api, getContainer }) {
    it("records Province changes from two Operators once per idempotency key", async function () {
      const firstOperator = await signInAsOperator(getContainer(), api, {
        email: "first-audit-operator@mze.store",
        password: "supersecret",
      });
      const secondOperator = await signInAsOperator(getContainer(), api, {
        email: "second-audit-operator@mze.store",
        password: "supersecret",
      });

      const countryRequest = {
        headers: { ...firstOperator.headers, "Idempotency-Key": "country-tax-region" },
      };
      const countryBody = {
        country_code: "es",
        provider_id: "tp_system",
        default_tax_rate: { name: "VAT", code: "vat", rate: 21 },
      };
      await expect(
        api.post("/admin/tax-regions", countryBody, {
          headers: { ...firstOperator.headers, "Idempotency-Key": "x".repeat(201) },
        }),
      ).rejects.toMatchObject({ response: { status: 400 } });

      const countryResponse = await api.post("/admin/tax-regions", countryBody, countryRequest);
      const countryReplay = await api.post("/admin/tax-regions", countryBody, countryRequest);
      const countryRegionId = TaxRegionResponseSchema.parse(countryResponse.data).tax_region.id;
      expect(TaxRegionResponseSchema.parse(countryReplay.data).tax_region.id).toEqual(
        countryRegionId,
      );

      const emptyProvinceRequest = {
        headers: { ...firstOperator.headers, "Idempotency-Key": "empty-province-tax-region" },
      };
      const emptyProvinceBody = {
        country_code: "es",
        province_code: "es-gc",
        parent_id: countryRegionId,
      };
      const emptyProvinceResponse = await api.post(
        "/admin/tax-regions",
        emptyProvinceBody,
        emptyProvinceRequest,
      );
      const emptyProvinceReplay = await api.post(
        "/admin/tax-regions",
        emptyProvinceBody,
        emptyProvinceRequest,
      );
      expect(TaxRegionResponseSchema.parse(emptyProvinceReplay.data).tax_region.id).toEqual(
        TaxRegionResponseSchema.parse(emptyProvinceResponse.data).tax_region.id,
      );

      const provinceRequest = {
        headers: { ...firstOperator.headers, "Idempotency-Key": "province-tax-region" },
      };
      const provinceBody = {
        country_code: "es",
        province_code: "es-tf",
        parent_id: countryRegionId,
        default_tax_rate: { name: "IGIC", code: "igic", rate: 7 },
      };
      const provinceResponse = await api.post("/admin/tax-regions", provinceBody, provinceRequest);
      await api.post("/admin/tax-regions", provinceBody, provinceRequest);
      const provinceRegionId = TaxRegionResponseSchema.parse(provinceResponse.data).tax_region.id;

      const directRateRequest = {
        headers: { ...firstOperator.headers, "Idempotency-Key": "province-direct-rate" },
      };
      const directRateBody = {
        tax_region_id: provinceRegionId,
        name: "Reduced IGIC",
        code: "igic-reduced",
        rate: 3,
      };
      const directRateResponse = await api.post(
        "/admin/tax-rates",
        directRateBody,
        directRateRequest,
      );
      await api.post("/admin/tax-rates", directRateBody, directRateRequest);
      const directRateId = TaxRateResponseSchema.parse(directRateResponse.data).tax_rate.id;

      await expect(
        api.post(
          "/admin/tax-rates",
          { ...directRateBody, metadata: { request: "changed" } },
          directRateRequest,
        ),
      ).rejects.toMatchObject({ response: { status: 409 } });

      const listedRatesResponse = await api.get(
        `/admin/tax-rates?tax_region_id=${provinceRegionId}`,
        firstOperator,
      );
      const listedRates = TaxRateListResponseSchema.parse(listedRatesResponse.data).tax_rates;
      const defaultRate = listedRates.find(function findDefaultRate(rate) {
        return rate.rate === 7;
      });

      if (!defaultRate) {
        throw new Error("The Province Tax Region has no default Tax Rate.");
      }

      const firstUpdateRequest = {
        headers: { ...secondOperator.headers, "Idempotency-Key": "province-rate-six" },
      };
      await api.post(`/admin/tax-rates/${defaultRate.id}`, { rate: 6 }, firstUpdateRequest);
      await api.post(`/admin/tax-rates/${defaultRate.id}`, { rate: 6 }, firstUpdateRequest);

      const secondUpdateRequest = {
        headers: { ...firstOperator.headers, "Idempotency-Key": "province-rate-five" },
      };
      await api.post(`/admin/tax-rates/${defaultRate.id}`, { rate: 5 }, secondUpdateRequest);

      const historyResponse = await api.get(
        "/admin/tax-rate-changes?province_code=es-tf&limit=100",
        firstOperator,
      );
      const history = TaxRateChangesResponseSchema.parse(historyResponse.data);

      await expect(
        api.get("/admin/tax-rate-changes?limit=not-a-number", firstOperator),
      ).rejects.toMatchObject({ response: { status: 400 } });
      await expect(
        api.get("/admin/tax-rate-changes?from=2026-02-31T00%3A00%3A00.000Z", firstOperator),
      ).rejects.toMatchObject({ response: { status: 400 } });

      expect(history.tax_rate_changes).toHaveLength(4);
      expect(history.tax_rate_changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "created",
            actor_email: "first-audit-operator@mze.store",
            actor_kind: "operator",
            before_rate: null,
            after_rate: 7,
            province_code: "es-tf",
            tax_rate_id: defaultRate.id,
          }),
          expect.objectContaining({
            action: "created",
            actor_email: "first-audit-operator@mze.store",
            actor_kind: "operator",
            before_rate: null,
            after_rate: 3,
            province_code: "es-tf",
            tax_rate_id: directRateId,
          }),
          expect.objectContaining({
            action: "updated",
            actor_email: "second-audit-operator@mze.store",
            actor_kind: "operator",
            before_rate: 7,
            after_rate: 6,
            province_code: "es-tf",
            tax_rate_id: defaultRate.id,
          }),
          expect.objectContaining({
            action: "updated",
            actor_email: "first-audit-operator@mze.store",
            actor_kind: "operator",
            before_rate: 6,
            after_rate: 5,
            province_code: "es-tf",
            tax_rate_id: defaultRate.id,
          }),
        ]),
      );
    });

    it("records seed-created Province rates with the system actor", async function () {
      await seedTerritory(getContainer(), TOY_DECLARATION);
      await seedTerritory(getContainer(), TOY_DECLARATION);

      const auditService = getContainer().resolve<TaxRateAuditModule>(TAX_RATE_AUDIT_MODULE);
      const result = await auditService.listChanges({
        actorId: "seed",
        limit: 100,
        offset: 0,
      });

      expect(result.changes).toHaveLength(2);
      expect(result.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "created",
            actor_kind: "system",
            actor_id: "seed",
            actor_email: null,
            province_code: null,
            before_rate: null,
            after_rate: 23,
          }),
          expect.objectContaining({
            action: "created",
            actor_kind: "system",
            actor_id: "seed",
            actor_email: null,
            province_code: "pt-30",
            before_rate: null,
            after_rate: 22,
          }),
        ]),
      );
    });
  },
});
