import { defineLink } from "@medusajs/framework/utils";
import ProductModule from "@medusajs/medusa/product";
import CatalogSyncModule from "~/modules/catalog-sync";

export default defineLink(
  ProductModule.linkable.product,
  CatalogSyncModule.linkable.catalogMapping,
);
