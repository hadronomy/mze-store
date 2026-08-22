import { defineLink } from "@medusajs/framework/utils";
import ProductModule from "@medusajs/medusa/product";
import ProductAuthoringModule from "~/modules/product-authoring";

export default defineLink(
  ProductModule.linkable.product,
  ProductAuthoringModule.linkable.productAuthoring,
);
