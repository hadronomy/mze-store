import { readFileSync } from "node:fs";

/**
 * Gives the admin dashboard the brand mark in its tab.
 *
 * Medusa has no branding option — `AdminOptions` exposes only `disable`,
 * `path`, `backendUrl`, `storefrontUrl`, and `vite`. Its bundler regenerates
 * `index.html` on every build with a placeholder
 * `<link rel="icon" href="data:," data-placeholder-favicon />`, and nothing
 * ever replaces it, so an Operator stares at a blank tab all day. Editing that
 * file directly would be overwritten on the next build; `transformIndexHtml`
 * is the supported seam.
 *
 * The mark is inlined as a data URI rather than served. The admin mounts at a
 * configurable path (`admin.path`), so a relative asset URL would break the
 * moment that changes, and Medusa has no static route the bundler can rely on.
 * One 539-byte SVG costs less than the coupling would.
 *
 * Only an SVG is injected. The admin is a desktop tool for Operators — there
 * is no home screen to add it to, and every browser that can run the dashboard
 * can render an SVG favicon.
 */

function markAsDataUri(): string {
  // `require.resolve`, not `createRequire(import.meta.url)`: the backend emits
  // file-per-file CommonJS (ADR-0012), where `import.meta` does not exist.
  const path = require.resolve("@mze-store/design-tokens/brand/icon.svg");
  // base64 rather than percent-encoding: the mark contains `#` in its fill,
  // which terminates the URL early when left raw.
  return `data:image/svg+xml;base64,${readFileSync(path).toString("base64")}`;
}

/** A Vite plugin that swaps Medusa's placeholder favicon for the brand mark. */
export function adminFavicon() {
  return {
    name: "mze-admin-favicon",
    transformIndexHtml(html: string) {
      return html.replace(
        /<link[^>]*data-placeholder-favicon[^>]*>/,
        `<link rel="icon" type="image/svg+xml" href="${markAsDataUri()}" />`,
      );
    },
  };
}
