import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { fontFile, fontStack } from "~/type";

/**
 * The Storefront and the Invoice renderer load the same faces by two different
 * routes: the Storefront imports Fontsource's stylesheets, and the renderer
 * registers files from `fontFile`. Neither can generate the other — Fontsource
 * ships `unicode-range` subsetting worth keeping, and the renderer needs bytes
 * rather than CSS. These tests are what stops the two sets drifting apart.
 */

const globals = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui", "src", "styles", "globals.css"),
  "utf8",
);

/** Exact stylesheets the Storefront imports, e.g. `@fontsource/spectral/300.css`. */
const imported = new Set(
  [...globals.matchAll(/@import "(@fontsource(?:-variable)?\/[^"]+)"/g)].map((match) => match[1]!),
);

/**
 * The stylesheet that loads a given registered file.
 *
 * Fontsource splits static families one file per weight and style, and puts a
 * variable family behind a single entry point. Checking the package alone
 * would pass while the Storefront loaded a different weight from the one the
 * renderer embeds.
 */
function stylesheetFor(font: (typeof fontFile)[number]): string {
  const [scope, name] = font.source.split("/");
  const packageName = `${scope}/${name}`;
  if (scope === "@fontsource-variable") return `${packageName}/index.css`;
  return `${packageName}/${font.weight}${font.style === "italic" ? "-italic" : ""}.css`;
}

const registeredPackages = new Set(
  fontFile.map((font) => font.source.split("/").slice(0, 2).join("/")),
);
const importedPackages = new Set(
  [...imported].map((entry) => entry.split("/").slice(0, 2).join("/")),
);

/** Families the Storefront's stacks actually name, minus generic fallbacks. */
const namedFamilies = Object.values(fontStack.web).flatMap((stack) =>
  [...stack.matchAll(/"([^"]+)"/g)].map((match) => match[1]!),
);

describe("font sources", () => {
  it.each(fontFile.map((font) => [`${font.family} ${font.weight} ${font.style}`, font] as const))(
    "the Storefront loads the exact cut the renderer registers for %s",
    (_label, font) => {
      expect([...imported]).toContain(stylesheetFor(font));
    },
  );

  it("registers a file for every imported package", () => {
    expect([...importedPackages].filter((name) => !registeredPackages.has(name))).toStrictEqual([]);
  });

  // A stack may name a family the Storefront never loads — it just falls
  // silently through to the next entry, which is how a design goes missing
  // without anything failing.
  it("loads every family the web stack names", () => {
    const registered = new Set<string>(fontFile.map((font) => font.family));
    expect(namedFamilies.filter((family) => !registered.has(family))).toStrictEqual([]);
  });

  it("registers only the Latin subset, which the renderer subsets further", () => {
    for (const font of fontFile) {
      expect(font.source).toMatch(/-latin-/);
      expect(font.source.endsWith(".woff2")).toBe(true);
    }
  });
});
