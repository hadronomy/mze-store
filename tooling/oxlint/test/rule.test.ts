import { expect, it } from "@effect/vitest";
import plugin from "@mze-store/oxlint";
import { preferTildeImportsRule as packedPreferTildeImportsRule } from "@mze-store/oxlint/rules";

import { preferTildeImportsRule } from "~/rules";

it("exports the compiled createOnce rule to Oxlint", () => {
  expect(preferTildeImportsRule.createOnce).toBeTypeOf("function");
});

it("exports the packed plugin and rules from the package surface", () => {
  expect(plugin).toBeDefined();
  expect(packedPreferTildeImportsRule.createOnce).toBeTypeOf("function");
});
