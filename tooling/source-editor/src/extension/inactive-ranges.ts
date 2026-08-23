/** A range in a text document, measured in UTF-16 offsets. */
export interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

/** The document ranges that describe one tagged source block. */
export interface SourceBlockRanges {
  /** The complete source body between the template delimiters. */
  readonly bodyRange: OffsetRange;
  /** Literal spans that the editor can dim when the block is inactive. */
  readonly literalRanges: readonly OffsetRange[];
}

/**
 * Returns the literal spans to dim for an inactive source block.
 *
 * A cursor on either body edge keeps the block active. This avoids a visible
 * state change while the cursor crosses the opening or closing delimiter.
 */
export function getInactiveLiteralRanges(
  block: SourceBlockRanges,
  selections: readonly OffsetRange[],
  highContrast: boolean,
): readonly OffsetRange[] {
  if (highContrast || selections.some((selection) => rangesIntersect(block.bodyRange, selection))) {
    return [];
  }

  return block.literalRanges;
}

function rangesIntersect(left: OffsetRange, right: OffsetRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}
