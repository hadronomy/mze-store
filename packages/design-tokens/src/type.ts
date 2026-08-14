/** The three roles a family can hold. No surface uses a fourth. */
export type FontRole = "display" | "body" | "mono";

/** A CSS `font-family` list, for one surface and one role. */
export type FontStack = Readonly<Record<FontRole, string>>;

/**
 * Family stacks, by surface.
 *
 * The Storefront and the Invoice share one stack because the Invoice renderer
 * embeds and subsets the real files (see `fontFile`). Email cannot rely on a
 * webfont at all, so it falls back to what a mail client already has. This
 * asymmetry is the reason a stack is a token and not a constant.
 */
export const fontStack = {
  /** The Storefront, and the Invoice renderer, which embeds the same files. */
  web: {
    // Whatever is named first here has to be a face the shop may self-host:
    // the Invoice renderer embeds font bytes into the PDF, which a CDN-only
    // licence cannot satisfy. Spectral is SIL OFL, which grants both. See
    // ADR-0024.
    display: '"Spectral", Georgia, serif',
    body: '"Inter Variable", system-ui, sans-serif',
    // Fontsource publishes the variable cut under this exact family name.
    // "Geist Mono" alone matches nothing and falls through to ui-monospace.
    mono: '"Geist Mono Variable", ui-monospace, monospace',
  },
  /** Email. No webfont survives the client matrix, so none is named. */
  email: {
    display: 'Georgia, "Times New Roman", serif',
    body: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  },
} as const satisfies Record<string, FontStack>;

/** One self-hosted font file. */
export type FontFile = Readonly<{
  family: string;
  /** A single weight, or the range a variable axis covers. */
  weight: string;
  style: "normal" | "italic";
  /** Module specifier. The bundler and the Invoice renderer both resolve it. */
  source: string;
}>;

/**
 * Every self-hosted file the Invoice renderer has to register.
 *
 * The Storefront does *not* read this list — it imports Fontsource's own
 * stylesheets, which carry `@font-face` rules subset by `unicode-range` across
 * seven ranges per family. Generating those from here would be strictly worse.
 * So the two Surfaces load the same files by two different routes, and
 * `test/font-sources.test.ts` holds them to the same set: a family named in
 * `fontStack.web` must appear here, and every package listed here must be one
 * the Storefront actually imports.
 *
 * Only the Latin subset is listed, because the renderer embeds and subsets the
 * file itself. Spanish, German, French, and Italian all sit inside Latin-1,
 * which the shop's five languages never leave.
 *
 * Spectral is static, so its two cuts are two files. That is still less than
 * the variable pair would cost, and the design uses exactly one weight.
 */
export const fontFile = [
  {
    family: "Spectral",
    weight: "300",
    style: "normal",
    source: "@fontsource/spectral/files/spectral-latin-300-normal.woff2",
  },
  {
    family: "Spectral",
    weight: "300",
    style: "italic",
    source: "@fontsource/spectral/files/spectral-latin-300-italic.woff2",
  },
  {
    family: "Inter Variable",
    weight: "100 900",
    style: "normal",
    source: "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  },
  {
    family: "Geist Mono Variable",
    weight: "100 900",
    style: "normal",
    source: "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  },
] as const satisfies readonly FontFile[];

/** A type step: the size and the line height that goes with it. */
export type TextSize = Readonly<{ size: string; leading: string }>;

/** Seven steps, written out. A computed ratio would only hide the decision. */
export const textSize = {
  xs: { size: "0.75rem", leading: "1rem" },
  sm: { size: "0.875rem", leading: "1.25rem" },
  base: { size: "1rem", leading: "1.5rem" },
  lg: { size: "1.125rem", leading: "1.625rem" },
  xl: { size: "1.5rem", leading: "1.875rem" },
  "2xl": { size: "2.25rem", leading: "2.375rem" },
  "3xl": { size: "3.5rem", leading: "3.5rem" },
} as const satisfies Record<string, TextSize>;

/**
 * The size below which the display family must not be used.
 *
 * A light display serif is weak at reading sizes. Above this it echoes the
 * wordmark; below it, use the body family. Only `2xl` and `3xl` clear it.
 */
export const displayMinSize = "2rem";

/**
 * Product data only: dosage, net volume, capsule count, INCI, SKU.
 *
 * Never navigation, labels, captions, or the copyright line. A mono used as
 * the house voice is a tell; a mono used as a data register is why the mono
 * exists.
 */
export const monoScope = "product-data" as const;
