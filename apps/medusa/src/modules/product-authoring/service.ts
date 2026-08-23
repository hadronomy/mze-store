import type { InferTypeOf } from "@medusajs/framework/types";
import { UniqueConstraintViolationException } from "@medusajs/framework/mikro-orm/core";
import { MedusaService } from "@medusajs/framework/utils";
import ProductAuthoring from "~/modules/product-authoring/models/product-authoring";
import { authoringError } from "./errors";
import type { EditAuthoringInput, EnsureAuthoringInput, ProductAuthoringRecordView } from "./types";

type ProductAuthoringRecord = InferTypeOf<typeof ProductAuthoring>;

// Publishing is the gated transition: an Operator must have moved the
// Product to `ready` first. The promotion workflow checks identity, price,
// editorial fields, media, and sync state before calling `markPublished`.
export default class ProductAuthoringModuleService extends MedusaService({
  ProductAuthoring,
}) {
  async ensureAuthoring(
    inputs: readonly EnsureAuthoringInput[],
  ): Promise<readonly ProductAuthoringRecordView[]> {
    if (!inputs.length) {
      return [];
    }

    const inputByProductId = new Map(inputs.map((input) => [input.productId, input]));
    const ids = [...inputByProductId.keys()];
    const existing = await this.listProductAuthorings({ product_id: ids });
    const knownIds = new Set(existing.map((row) => row.product_id));
    const missing = ids.filter((id) => !knownIds.has(id));

    try {
      await this.createProductAuthorings(
        missing.map((product_id) => ({
          product_id,
          state: inputByProductId.get(product_id)!.initialState,
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
    const nextState = input.state ?? record.state;
    const nextBlockedReason =
      input.blockedReason !== undefined
        ? normalizeBlockedReason(input.blockedReason)
        : input.state !== undefined && input.state !== "blocked"
          ? null
          : record.blocked_reason;

    if (
      (nextState === "blocked" && nextBlockedReason === null) ||
      (nextState !== "blocked" && nextBlockedReason !== null)
    ) {
      throw authoringError(
        "authoring_blocked_reason_invalid",
        "A blocked Authoring State needs a non-empty blocked reason, and every other state must have no blocked reason.",
      );
    }

    const patch = compact({
      state: input.state,
      blocked_reason: nextBlockedReason,
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
    if (record.state !== "ready" && record.state !== "published") {
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

  async restoreAuthoring(snapshot: ProductAuthoringRecordView): Promise<void> {
    const record = await this.requireRecord(snapshot.productId);
    await this.updateProductAuthorings({
      id: record.id,
      state: snapshot.state,
      blocked_reason: snapshot.blockedReason,
      seo_title: snapshot.seoTitle,
      seo_description: snapshot.seoDescription,
      colour: snapshot.colour,
      merchandising_rank: snapshot.merchandisingRank,
    });
  }

  async getAuthoring(productId: string): Promise<ProductAuthoringRecordView | null> {
    const [record] = await this.listProductAuthorings({ product_id: productId }, { take: 1 });
    return record ? toView(record) : null;
  }

  async removeAuthoring(productId: string): Promise<void> {
    const [record] = await this.listProductAuthorings({ product_id: productId }, { take: 1 });
    if (record) {
      await this.deleteProductAuthorings(record.id);
    }
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
    blockedReason: record.blocked_reason,
    seoTitle: record.seo_title,
    seoDescription: record.seo_description,
    colour: record.colour,
    merchandisingRank: record.merchandising_rank,
  };
}

function normalizeBlockedReason(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length ? normalized : null;
}

function compact<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}
