import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { TerritoryDeclaration } from "./declaration";

type AnyTerritoryDeclaration = TerritoryDeclaration<string, `${string}-${string}`>;

const queryOf = (container: MedusaContainer) => container.resolve(ContainerRegistrationKeys.QUERY);

export async function findStore(container: MedusaContainer) {
  const { data } = await queryOf(container).graph({
    entity: "store",
    fields: [
      "id",
      "default_sales_channel_id",
      "default_region_id",
      "supported_currencies.currency_code",
    ],
  });

  return data[0];
}

export async function findSalesChannelByName(container: MedusaContainer, name: string) {
  const { data } = await queryOf(container).graph({
    entity: "sales_channel",
    fields: ["id"],
    filters: { name },
  });

  return data[0];
}

export async function findRegionForDeclaration(
  container: MedusaContainer,
  declaration: AnyTerritoryDeclaration,
) {
  const { data } = await queryOf(container).graph({
    entity: "region",
    fields: ["id"],
    filters: { countries: { iso_2: declaration.country } },
  });

  return data[0];
}

export async function findTaxRegionsForDeclaration(
  container: MedusaContainer,
  declaration: AnyTerritoryDeclaration,
) {
  const { data } = await queryOf(container).graph({
    entity: "tax_region",
    fields: ["id", "province_code"],
    filters: { country_code: declaration.country },
  });

  return data;
}

const STOCK_LOCATION_FIELDS = [
  "id",
  "sales_channels.id",
  "fulfillment_sets.id",
  "fulfillment_sets.name",
  "fulfillment_sets.service_zones.name",
];

async function findStockLocation(container: MedusaContainer, filters: Record<string, string>) {
  const { data } = await queryOf(container).graph({
    entity: "stock_location",
    fields: STOCK_LOCATION_FIELDS,
    filters,
  });

  return data[0];
}

export function findDeclaredStockLocation(
  container: MedusaContainer,
  declaration: AnyTerritoryDeclaration,
) {
  return findStockLocation(container, { name: declaration.stockLocationName });
}

export function findStockLocationById(container: MedusaContainer, id: string) {
  return findStockLocation(container, { id });
}

export async function findShippingProfileByName(container: MedusaContainer, name: string) {
  const { data } = await queryOf(container).graph({
    entity: "shipping_profile",
    fields: ["id"],
    filters: { name },
  });

  return data[0];
}

export async function findProductByHandle(container: MedusaContainer, handle: string) {
  const { data } = await queryOf(container).graph({
    entity: "product",
    fields: ["id"],
    filters: { handle },
  });

  return data[0];
}

export async function findPublishableKeyByTitle(container: MedusaContainer, title: string) {
  const { data } = await queryOf(container).graph({
    entity: "api_key",
    fields: ["id", "token", "sales_channels.id"],
    filters: { title, type: "publishable" },
  });

  return data[0];
}
