import type { CatalogItem, CatalogTemplate, CatalogVariant } from "@mze-store/odoo-bridge";

export function isCatalogTemplateUnavailable(template: CatalogTemplate): boolean {
  return !template.active || !template.saleOk;
}

export function isCatalogVariantUnavailable(item: CatalogItem, variant: CatalogVariant): boolean {
  return isCatalogTemplateUnavailable(item.template) || !variant.active || !variant.saleOk;
}
