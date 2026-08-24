import { describe, expect, test } from "vite-plus/test";

import { getInactiveLiteralRanges, type SourceBlockRanges } from "~/extension/inactive-ranges";

const block = (start: number, end: number): SourceBlockRanges => ({
  bodyRange: { start, end },
  literalRanges: [{ start, end }],
});

describe("getInactiveLiteralRanges", () => {
  test("dims a source block when every selection is outside its body", () => {
    const sourceBlock = block(10, 30);

    expect(getInactiveLiteralRanges(sourceBlock, [{ start: 0, end: 5 }], false)).toEqual(
      sourceBlock.literalRanges,
    );
  });

  test("keeps a block active when a cursor is inside its body", () => {
    expect(getInactiveLiteralRanges(block(10, 30), [{ start: 20, end: 20 }], false)).toEqual([]);
  });

  test("keeps a block active when a selection crosses its body", () => {
    expect(getInactiveLiteralRanges(block(10, 30), [{ start: 0, end: 11 }], false)).toEqual([]);
  });

  test("treats a cursor at either body edge as active", () => {
    const sourceBlock = block(10, 30);

    expect(getInactiveLiteralRanges(sourceBlock, [{ start: 10, end: 10 }], false)).toEqual([]);
    expect(getInactiveLiteralRanges(sourceBlock, [{ start: 30, end: 30 }], false)).toEqual([]);
  });

  test("does not dim in high contrast mode", () => {
    expect(getInactiveLiteralRanges(block(10, 30), [], true)).toEqual([]);
  });

  test("returns all literal ranges for an inactive block", () => {
    const sourceBlock: SourceBlockRanges = {
      bodyRange: { start: 10, end: 50 },
      literalRanges: [
        { start: 11, end: 20 },
        { start: 30, end: 49 },
      ],
    };

    expect(getInactiveLiteralRanges(sourceBlock, [], false)).toEqual(sourceBlock.literalRanges);
  });
});
