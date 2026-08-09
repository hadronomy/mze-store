import { expect, test } from "vite-plus/test";

import { assertPortlessVersion, REQUIRED_PORTLESS_VERSION } from "./check.mjs";
import { isMedusaRouteConflict, medusaRouteConflictMessage } from "./medusa.mjs";

test("accepts the pinned Portless version", () => {
  const version = assertPortlessVersion({
    executable: "portless",
    run: () => ({ status: 0, stdout: `${REQUIRED_PORTLESS_VERSION}\n`, stderr: "" }),
  });

  expect(version).toBe(REQUIRED_PORTLESS_VERSION);
});

test("rejects a different Portless version", () => {
  expect(() =>
    assertPortlessVersion({
      executable: "portless",
      run: () => ({ status: 0, stdout: "0.15.4\n", stderr: "" }),
    }),
  ).toThrow(/Portless 0\.15\.5 is required/);
});

test("reports when Portless is not installed", () => {
  expect(() =>
    assertPortlessVersion({
      executable: "portless",
      run: () => ({ status: null, stdout: "", stderr: "", error: new Error("not found") }),
    }),
  ).toThrow(/bun add --global portless@0\.15\.5/);
});

test("explains how to start a Storefront when Medusa owns its route", () => {
  expect(
    isMedusaRouteConflict(
      'Error: "medusa.mze-store.localhost" is already registered by a running process',
    ),
  ).toBe(true);
  expect(medusaRouteConflictMessage).toMatch(/dev:portless:storefront/);
  expect(medusaRouteConflictMessage).toMatch(/Do not use `--force`/);
});
