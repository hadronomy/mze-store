import type { InferTypeOf } from "@medusajs/framework/types";
import { UniqueConstraintViolationException } from "@medusajs/framework/mikro-orm/core";
import { MedusaService } from "@medusajs/framework/utils";
import ProductAuthoring from "~/modules/product-authoring/models/product-authoring";
import { authoringError } from "./errors";
import type { EditAuthoringInput, ProductAuthoringRecordView } from "./types";

export type ProductAuthoringRecord = InferTypeOf<typeof ProductAuthoring>;

// Publishing is the gated transition: an Operator must have moved the
// Product to `ready` first. The promotion workflow checks identity, price,
// editorial fields, media, and sync state before calling `markPublished`.
const PUBLISHABLE_STATES: readonly string[] = ["ready"];

export default class ProductAuthoringModuleService extends MedusaService({
  ProductAuthoring,
}) {
  async ensureAuthoring(
    productIds: readonly string[],
  ): Promise<readonly ProductAuthoringRecordView[]> {
    if (!productIds.length) {
      return [];
    }

    const ids = [...new Set(productIds)];
    const existing = await this.listProductAuthorings({ product_id: ids });
    const knownIds = new Set(existing.map((row) => row.product_id));
    const missing = ids.filter((id) => !knownIds.has(id));

    try {
      await this.createProductAuthorings(
        missing.map((product_id) => ({
          product_id,
          state: "imported" as const,
          merchandising_rank: 0,
        })),
      );
    } catch (thrown) {
      // A concurrent intake for the same Product created the row first; the
      // read below becomes the single source of truth either way.
      if (
        !(thrown instanceof UniqueConstraintViolationException) ||
        thrown.code !== "23505" ||
        !`${thrown.message} ${thrown.sqlMessage ?? ""} ${thrown.errmsg ?? ""}`.includes(
          "IDX_product_authoring_product_id_unique",
        )
      ) {
        throw thrown;
      }
    }

    const records = missing.length
      ? await this.listProductAuthorings({ product_id: ids })
      : existing;

    return records.map(toView);
  }

  async editAuthoring(input: EditAuthoringInput): Promise<ProductAuthoringRecordView> {
    const record = await this.requireRecord(input.productId);

    const patch = compact({
      state: input.state,
      blocked_reason: input.blockedReason,
      seo_title: input.seoTitle,
      seo_description: input.seoDescription,
      colour: input.colour,
      merchandising_rank: input.merchandisingRank,
    });
    const updated = await this.updateProductAuthorings({ id: record.id, ...patch });

    return toView(updated);
  }

  async markPublished(productId: string): Promise<ProductAuthoringRecordView> {
    const record = await this.requireRecord(productId);
    if (!PUBLISHABLE_STATES.includes(record.state)) {
      throw authoringError(
        "authoring_state_conflict",
        `The Product ${productId} must be ready before promotion; it is ${record.state}.`,
      );
    }

    const updated = await this.updateProductAuthorings({
      id: record.id,
      state: "published",
      blocked_reason: null,
    });

    return toView(updated);
  }

  async getAuthoring(productId: string): Promise<ProductAuthoringRecordView | null> {
    const [record] = await this.listProductAuthorings({ product_id: productId }, { take: 1 });
    return record ? toView(record) : null;
  }

  async listAuthoring(
    productIds: readonly string[],
  ): Promise<readonly ProductAuthoringRecordView[]> {
    if (!productIds.length) {
      return [];
    }

    const records = await this.listProductAuthorings({ product_id: [...productIds] });
    return records.map(toView);
  }

  async requireRecord(productId: string): Promise<ProductAuthoringRecord> {
    const [record] = await this.listProductAuthorings({ product_id: productId }, { take: 1 });
    if (!record) {
      throw authoringError(
        "authoring_product_unknown",
        `The Product ${productId} has no Authoring record.`,
      );
    }

    return record;
  }
}

function toView(record: ProductAuthoringRecord): ProductAuthoringRecordView {
  return {
    productId: record.product_id,
    state: record.state,
    seoTitle: record.seo_title,
    seoDescription: record.seo_description,
    colour: record.colour,
    merchandisingRank: record.merchandising_rank,
  };
}

function compact<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}
