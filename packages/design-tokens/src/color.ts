/**
 * One brand colour, in the two forms the surfaces need.
 *
 * Both values describe the same colour. `test/color.test.ts` proves it, so a
 * change to one that forgets the other fails the build rather than shipping a
 * green email next to a grey storefront.
 */
export type BrandColor = Readonly<{
  /** The authored value. The Storefront and the Invoice renderer read this. */
  oklch: string;
  /** The same colour in sRGB. Email clients parse nothing else. */
  hex: string;
}>;

/**
 * The brand primitives. Nine values, no generated ramp.
 *
 * Neutrals sit at hue 92 with very low chroma: a warm paper ground. The
 * logo's second colour (#70777D) is deliberately absent — it is cool, and a
 * cool grey fights warm paper. It belongs to the logo lockup alone.
 */
export const color = {
  /** The page ground. */
  paper: { oklch: "oklch(0.985 0.004 92)", hex: "#FBFAF7" },
  /** A surface lifted off the ground without a border. */
  paperRaised: { oklch: "oklch(0.968 0.006 92)", hex: "#F6F4F0" },
  /**
   * The ground behind every product image.
   *
   * Its own value, not an alias: suppliers ship images on white, on
   * transparent, and on lifestyle backgrounds, and one imposed ground is what
   * makes forty supplier brands read as one shop. It moves independently of
   * the page ground.
   */
  productGround: { oklch: "oklch(0.972 0.005 92)", hex: "#F7F6F2" },
  /** Rules and borders. Non-text, so it carries no contrast duty. */
  line: { oklch: "oklch(0.9 0.008 92)", hex: "#E0DED8" },
  /**
   * Secondary text.
   *
   * Dark enough to clear AA on the *darkest* ground, not just on paper. At
   * L=0.55 it measured 4.44:1 on `paperRaised` — under the 4.5:1 floor — so
   * any muted caption on a lifted surface failed while the same caption on the
   * page passed. `test/color.test.ts` now checks every text colour against
   * every ground so that trap cannot come back.
   */
  inkMuted: { oklch: "oklch(0.53 0.01 92)", hex: "#6E6C65" },
  /** Primary text and primary actions. 16.58:1 on paper. */
  ink: { oklch: "oklch(0.22 0.012 92)", hex: "#1D1A14" },
  /**
   * The logo green, exactly.
   *
   * 4.07:1 on paper, so it passes for large text and non-text and fails for
   * body copy. Use it for the mark, in-stock state, and the active facet —
   * never for a paragraph or a small link. That is what `leafDeep` is for.
   */
  leaf: { oklch: "oklch(0.5704 0.1126 146.47)", hex: "#46894E" },
  /** The readable green. 7.77:1 on paper — passes AA and AAA for body. */
  leafDeep: { oklch: "oklch(0.42 0.095 146.5)", hex: "#245A2C" },
  /** A green tint to fill a surface behind `leafDeep` text. */
  leafWash: { oklch: "oklch(0.95 0.02 146.5)", hex: "#E6F2E7" },
  /** Destructive actions and errors. The only colour outside the two families. */
  signal: { oklch: "oklch(0.52 0.18 27)", hex: "#BA2B28" },
} as const satisfies Record<string, BrandColor>;

/** The name of a brand colour. */
export type ColorName = keyof typeof color;

/** Colours a Surface may put behind text. */
export const groundColor = ["paper", "paperRaised", "productGround", "leafWash"] as const;

/**
 * Colours allowed to carry body copy, at any size, on any ground.
 *
 * `leaf` is deliberately absent. It is the logo green and it measures 4.07:1
 * on paper — correct for the mark, state, and non-text, and never for a
 * paragraph. `leafDeep` exists to carry the text `leaf` cannot.
 */
export const bodyTextColor = ["ink", "inkMuted", "leafDeep"] as const;
