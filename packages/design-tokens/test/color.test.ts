import { converter, formatHex, wcagContrast } from "culori";
import { describe, expect, it } from "vite-plus/test";

import { bodyTextColor, color, groundColor, type BrandColor } from "~/color";
import { fontFile, fontStack, textSize } from "~/type";

const toRgb = converter("rgb");

/** Every text/ground pair a Surface is allowed to produce. */
const textOnGround = bodyTextColor.flatMap((text) =>
  groundColor.map((ground) => [text, ground] as const),
);

describe("brand colours", () => {
  // The two forms of a colour are authored by hand, because only email needs
  // the resolved one. This is what stops them drifting apart.
  it.each(Object.entries(color) as [string, BrandColor][])(
    "%s resolves to its own hex",
    (_name, value) => {
      expect(formatHex(toRgb(value.oklch))?.toUpperCase()).toBe(value.hex);
    },
  );

  it("keeps the logo green exact", () => {
    expect(color.leaf.hex).toBe("#46894E");
  });

  // A muted colour that clears AA on the page but not on a lifted surface is
  // the trap this covers: the same caption passes or fails depending on which
  // ground it lands on, and nothing in the type system catches it.
  it.each(textOnGround)("%s reads on %s", (text, ground) => {
    expect(wcagContrast(color[text].hex, color[ground].hex)).toBeGreaterThanOrEqual(4.5);
  });

  // leaf is the mark, state, and non-text only. If it ever clears the body
  // threshold, someone has lightened the ground and the rule silently died.
  it("keeps leaf below the body-text threshold", () => {
    expect(wcagContrast(color.leaf.hex, color.paper.hex)).toBeLessThan(4.5);
  });
});

describe("type", () => {
  it("names a family for every role on every surface", () => {
    for (const stack of Object.values(fontStack)) {
      for (const role of ["display", "body", "mono"] as const) {
        expect(stack[role]).not.toBe("");
      }
    }
  });

  // Email cannot load a webfont, so naming one there would silently fall
  // through to a stack nobody chose.
  it("names no self-hosted family in the email stack", () => {
    const families = new Set<string>(fontFile.map((font) => font.family));
    for (const stack of Object.values(fontStack.email)) {
      for (const family of families) {
        expect(stack).not.toContain(family);
      }
    }
  });

  it("orders the steps", () => {
    const sizes = Object.values(textSize).map((step) => Number.parseFloat(step.size));
    expect(sizes).toStrictEqual([...sizes].sort((a, b) => a - b));
  });
});
