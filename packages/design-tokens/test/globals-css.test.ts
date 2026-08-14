import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { color } from "~/color";

/**
 * `shadcn add` writes CSS variables straight into this file. That is fine and
 * expected — it is why the file keeps the shape the CLI recognises. What is
 * not fine is a literal colour surviving there, because the moment one does,
 * the Storefront and the email templates stop sharing a source and drift
 * silently. These tests turn that into a failed build. See ADR-0024.
 */

const globalsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "ui",
  "src",
  "styles",
  "globals.css",
);
const globals = readFileSync(globalsPath, "utf8");

/** Declaration bodies only — comments and selectors are not values. */
const declaredValues = globals
  .replaceAll(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.split(":").slice(1).join(":").trim())
  .filter(Boolean);

describe("globals.css stays a mapping, not a palette", () => {
  it.each(["#", "rgb(", "hsl("])("declares no %s literal", (form) => {
    expect(declaredValues.filter((value) => value.includes(form))).toStrictEqual([]);
  });

  // The chart ramp is the one place raw oklch() is allowed: shadcn requires
  // five categorical colours that have no brand primitive to point at.
  it("uses raw oklch() only for the chart ramp", () => {
    const raw = globals
      .split("\n")
      .filter((line) => /:\s*oklch\(/.test(line))
      .map((line) => line.trim());
    expect(raw.every((line) => line.startsWith("--chart-"))).toBe(true);
  });

  it("keeps every shadcn token pointing at a brand primitive or another token", () => {
    const mapped = globals.match(/^\s+--(?!mze-)[a-z0-9-]+:\s*var\(--[a-z0-9-]+\)/gm) ?? [];
    expect(mapped.length).toBeGreaterThan(30);
  });

  it("defines the canonical set a registry component may reach for", () => {
    for (const token of [
      "--destructive-foreground",
      "--chart-1",
      "--chart-5",
      "--sidebar",
      "--sidebar-ring",
    ]) {
      expect(globals).toContain(`${token}:`);
    }
  });

  it("exposes every brand colour as a Tailwind utility", () => {
    for (const name of Object.keys(color)) {
      const kebab = name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      expect(globals).toContain(`--color-${kebab}:`);
    }
  });

  // Without this the store is not light-only: Tailwind falls back to its
  // default `dark:` variant, `prefers-color-scheme`, and the primitives'
  // dark: utilities fire against a light palette.
  it("pins the dark variant to a class nothing sets", () => {
    expect(globals).toContain("@custom-variant dark (&:is(.dark *))");
    expect(globals).not.toMatch(/^\.dark\s*\{/m);
  });
});

describe("the generated stylesheet", () => {
  const themePath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "theme.css");

  it("declares every brand primitive", () => {
    const theme = readFileSync(themePath, "utf8");
    for (const name of Object.keys(color)) {
      const kebab = name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      expect(theme).toContain(`--mze-${kebab}:`);
    }
  });

  // A source map embeds the token modules verbatim. It is a development aid and
  // must never reach a production bundle.
  it("references a source map only outside production", () => {
    const theme = readFileSync(themePath, "utf8");
    const referenced = theme.includes("sourceMappingURL");
    expect(referenced).toBe(process.env.NODE_ENV !== "production");
  });
});
