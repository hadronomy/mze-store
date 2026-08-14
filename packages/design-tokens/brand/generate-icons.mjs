// Generates the browser and OS icon set from brand/icon.svg.
//
// The outputs are committed, not built in CI. They change when the logo does,
// which is approximately never, and generating them during the image build
// would put a raster toolchain inside a Docker build this repo holds to
// bit-reproducibility.
//
// Requires ImageMagick 7 (`magick`) on PATH. Run by hand:
//   node packages/design-tokens/brand/generate-icons.mjs
//
// The mark is drawn with rotations baked into the path data rather than
// `transform="rotate()"`, because several rasterisers — ImageMagick's own
// internal SVG renderer among them — quietly mangle the transform and emit a
// clipped icon.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "icon.svg");

/** Warm paper, matching --mze-paper. Opaque targets must not be pure white. */
const PAPER = "#FBFAF7";

/**
 * Only the Storefront ships the raster set. The Medusa admin inlines the SVG
 * as a data URI instead — see the plugin in medusa-config.ts — so it needs no
 * served assets and makes no assumption about where the admin is mounted.
 */
const targets = [join(here, "..", "..", "..", "apps", "storefront", "public")];

function magick(args) {
  execFileSync("magick", args, { stdio: "inherit" });
}

/** Transparent PNG at one size, for tabs and `purpose: any` manifest icons. */
function transparent(out, size) {
  magick(["-background", "none", source, "-resize", `${size}x${size}`, `PNG32:${out}`]);
}

/**
 * Opaque PNG on paper, for targets that composite on an unknown colour.
 * iOS puts apple-touch-icon on the home screen background and applies its own
 * rounding, so the file must be square, opaque, and unrounded.
 */
function onPaper(out, size, markRatio) {
  const mark = Math.round(size * markRatio);
  const tmp = `${out}.mark.png`;
  magick(["-background", "none", source, "-resize", `${mark}x${mark}`, `PNG32:${tmp}`]);
  // PNG24 drops the alpha channel outright. Leaving a uniformly-opaque channel
  // in place works, but iOS treats any transparency as black, so it is better
  // for the file to have no way to express it.
  magick([
    "-size",
    `${size}x${size}`,
    `xc:${PAPER}`,
    tmp,
    "-gravity",
    "center",
    "-composite",
    "-alpha",
    "remove",
    "-alpha",
    "off",
    `PNG24:${out}`,
  ]);
  rmSync(tmp);
}

for (const dir of targets) {
  mkdirSync(dir, { recursive: true });

  // Tab icon. Modern browsers prefer this over the .ico.
  execFileSync("cp", [source, join(dir, "icon.svg")]);

  // Legacy and bare /favicon.ico requests, which some clients issue blind.
  transparent(join(dir, "icon-32.png"), 32);
  magick([join(dir, "icon-32.png"), "-define", "icon:auto-resize=32,16", join(dir, "favicon.ico")]);
  rmSync(join(dir, "icon-32.png"));

  // Manifest icons, purpose "any".
  transparent(join(dir, "icon-192.png"), 192);
  transparent(join(dir, "icon-512.png"), 512);

  // iOS. One size is enough; iOS ignores `sizes` and rounds the corners itself.
  onPaper(join(dir, "apple-touch-icon.png"), 180, 0.72);

  // Android adaptive. The safe zone is a centred circle of radius 40% of the
  // width, and the outer 10% may be cropped, so the mark sits well inside it.
  onPaper(join(dir, "icon-maskable-512.png"), 512, 0.56);
}

console.log("icons written to:\n  " + targets.join("\n  "));
