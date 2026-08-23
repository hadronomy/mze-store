export const PRODUCT_AUTHORING_MODULE = "product_authoring" as const;

// The Authoring State vocabulary from issue #131. `published` records the
// Operator's intent. Product status projects that intent with the current
// source and Sync Record state.
export const AUTHORING_STATES = ["imported", "authoring", "ready", "published", "blocked"] as const;

export type AuthoringState = (typeof AUTHORING_STATES)[number];

// States an Operator may move to freely. Reaching `published` runs the
// promotion gate instead, and `imported` only appears at intake.
export const OPERATOR_AUTHORING_STATES = ["authoring", "ready", "blocked"] as const;

export type OperatorAuthoringState = (typeof OPERATOR_AUTHORING_STATES)[number];

export type EnsureAuthoringInput = Readonly<{
  productId: string;
  initialState: "imported" | "published";
}>;

export const AUTHORING_ERROR_CODES = [
  "authoring_product_unmapped",
  "authoring_price_invalid",
  "authoring_editorial_incomplete",
  "authoring_media_missing",
  "authoring_sync_unresolved",
  "authoring_source_unavailable",
  "authoring_blocked_reason_invalid",
  "authoring_promotion_required",
  "authoring_state_conflict",
  "authoring_product_unknown",
] as const;

export type AuthoringErrorCode = (typeof AUTHORING_ERROR_CODES)[number];

export type EditAuthoringInput = Readonly<{
  productId: string;
  state?: OperatorAuthoringState;
  blockedReason?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  colour?: string | null;
  merchandisingRank?: number;
}>;

export type ProductAuthoringRecordView = Readonly<{
  productId: string;
  state: AuthoringState;
  blockedReason: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  colour: string | null;
  merchandisingRank: number;
}>;
