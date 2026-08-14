import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { color } from "~/color";

/**
 * Icons are the assets nobody notices are broken until a Shopper sees a blank
 * tab or a black square on their home screen. Nothing else in the build
 * inspects them, so these checks stand in for that.
 */

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, "..", "brand");
const publicDir = join(here, "..", "..", "..", "apps", "storefront", "public");

const read = (path: string) => readFileSync(path);
const png = (name: string) => read(join(publicDir, name));

/** Width, height, and colour type out of a PNG's IHDR chunk. */
function pngSize(bytes: Buffer) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

describe("brand mark", () => {
  const svg = readFileSync(join(brand, "icon.svg"), "utf8");

  it("is the leaf green, exactly", () => {
    expect(svg).toContain(color.leaf.hex);
  });

  // Several rasterisers, ImageMagick's internal SVG renderer among them,
  // silently mangle rotate() and emit a clipped mark. Baked coordinates render
  // the same everywhere.
  it("bakes rotation into path data instead of transforms", () => {
    expect(svg).not.toContain("transform=");
  });

  it("is square, so no target has to letterbox it", () => {
    expect(svg).toContain('viewBox="0 0 100 100"');
  });
});

describe("storefront icon set", () => {
  it.each([
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-512.png", 512],
    ["apple-touch-icon.png", 180],
  ])("%s is square at its declared size", (name, size) => {
    const { width, height } = pngSize(png(name));
    expect([width, height]).toStrictEqual([size, size]);
  });

  // iOS composites any transparency in a touch icon against black. Colour
  // type 2 is truecolour with no alpha channel at all, so it cannot happen.
  it.each(["apple-touch-icon.png", "icon-maskable-512.png"])("%s carries no alpha", (name) => {
    expect(pngSize(png(name)).colourType).toBe(2);
  });

  it("ships an ICO for clients that request /favicon.ico blind", () => {
    const ico = read(join(publicDir, "favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBe(2); // 32 and 16
  });

  it("declares only maskable and any, never both on one file", () => {
    const manifest = JSON.parse(readFileSync(join(publicDir, "manifest.webmanifest"), "utf8")) as {
      readonly icons: ReadonlyArray<{ readonly purpose: string; readonly src: string }>;
    };
    for (const icon of manifest.icons) {
      expect(["any", "maskable"]).toContain(icon.purpose);
    }
    expect(manifest.icons.filter((icon) => icon.purpose === "maskable")).toHaveLength(1);
  });

  it("points the manifest at files that exist", () => {
    const manifest = JSON.parse(readFileSync(join(publicDir, "manifest.webmanifest"), "utf8")) as {
      readonly icons: ReadonlyArray<{ readonly src: string }>;
    };
    for (const icon of manifest.icons) {
      expect(() => png(icon.src.replace(/^\//, ""))).not.toThrow();
    }
  });
});
