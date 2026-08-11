import { Module } from "@medusajs/framework/utils";
import TaxRateAuditModuleService from "./service";
import { TAX_RATE_AUDIT_MODULE } from "./types";

export { TAX_RATE_AUDIT_MODULE };
export type {
  TaxRateAuditAction,
  TaxRateAuditActor,
  TaxRateChangeFilters,
  TaxRateChangeInput,
} from "./types";

export default Module(TAX_RATE_AUDIT_MODULE, {
  service: TaxRateAuditModuleService,
});
