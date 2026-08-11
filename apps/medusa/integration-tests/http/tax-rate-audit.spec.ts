import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { signInAsOperator } from "../utils/operator";

jest.setTimeout(120 * 1000);

type TaxRate = {
  id: string;
  rate: number;
};

type TaxRateChange = {
  action: "created" | "updated";
  actor_email: string | null;
  actor_kind: "operator" | "system";
  after_rate: number | null;
  before_rate: number | null;
  province_code: string | null;
  tax_rate_id: string;
};

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    it("records Tax Rate create and update changes once per idempotency key", async () => {
      const operator = await signInAsOperator(getContainer(), api, {
        email: "audit-operator@mze.store",
        password: "supersecret",
      });

      const idempotentRegionCreate = {
        headers: { ...operator.headers, "Idempotency-Key": "tax-region-audit-create" },
      };
      const regionData = {
        country_code: "es",
        provider_id: "tp_system",
        default_tax_rate: { name: "VAT", code: "vat", rate: 21 },
      };
      const createdRegion = await api.post(
        "/admin/tax-regions",
        regionData,
        idempotentRegionCreate,
      );
      const replayedRegion = await api.post(
        "/admin/tax-regions",
        regionData,
        idempotentRegionCreate,
      );
      const regionId = createdRegion.data.tax_region.id as string;
      expect(replayedRegion.data.tax_region.id).toEqual(regionId);

      const idempotentCreate = {
        headers: { ...operator.headers, "Idempotency-Key": "tax-rate-audit-create" },
      };
      const createdRate = await api.post(
        "/admin/tax-rates",
        { tax_region_id: regionId, name: "Reduced VAT", code: "vat-reduced", rate: 10 },
        idempotentCreate,
      );
      const replayedRate = await api.post(
        "/admin/tax-rates",
        { tax_region_id: regionId, name: "Reduced VAT", code: "vat-reduced", rate: 10 },
        idempotentCreate,
      );
      const directRateId = createdRate.data.tax_rate.id as string;
      expect(replayedRate.data.tax_rate.id).toEqual(directRateId);

      const listedRates = await api.get(`/admin/tax-rates?tax_region_id=${regionId}`, operator);
      const rate = (listedRates.data.tax_rates as TaxRate[]).find(({ rate }) => rate === 21)!;

      const idempotentUpdate = {
        headers: { ...operator.headers, "Idempotency-Key": "tax-rate-audit-update" },
      };
      await api.post(`/admin/tax-rates/${rate.id}`, { rate: 18 }, idempotentUpdate);
      await api.post(`/admin/tax-rates/${rate.id}`, { rate: 18 }, idempotentUpdate);

      const history = await api.get(
        `/admin/tax-rate-changes?tax_region_id=${regionId}&limit=100`,
        operator,
      );
      const changes = history.data.tax_rate_changes as TaxRateChange[];

      expect(changes).toHaveLength(3);
      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "created",
            actor_email: "audit-operator@mze.store",
            actor_kind: "operator",
            before_rate: null,
            after_rate: 21,
            province_code: null,
            tax_rate_id: rate.id,
          }),
          expect.objectContaining({
            action: "created",
            actor_email: "audit-operator@mze.store",
            actor_kind: "operator",
            before_rate: null,
            after_rate: 10,
            province_code: null,
            tax_rate_id: directRateId,
          }),
          expect.objectContaining({
            action: "updated",
            actor_email: "audit-operator@mze.store",
            actor_kind: "operator",
            before_rate: 21,
            after_rate: 18,
            province_code: null,
            tax_rate_id: rate.id,
          }),
        ]),
      );
    });
  },
});
