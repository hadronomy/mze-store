import { model } from "@medusajs/framework/utils";
import { AUTHORING_STATES } from "~/modules/product-authoring/types";

const ProductAuthoring = model
  .define("product_authoring", {
    id: model.id({ prefix: "prauth" }).primaryKey(),
    product_id: model.text(),
    state: model.enum([...AUTHORING_STATES]),
    seo_title: model.text().nullable(),
    seo_description: model.text().nullable(),
    colour: model.text().nullable(),
    merchandising_rank: model.number().default(0),
    blocked_reason: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_product_authoring_product_id_unique",
      on: ["product_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_product_authoring_state",
      on: ["state"],
      where: "deleted_at IS NULL",
    },
  ]);

export default ProductAuthoring;
