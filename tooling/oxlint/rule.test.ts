import { expect, it } from "@effect/vitest";

import { preferTildeImportsRule } from "./index";

it("exports the compiled createOnce rule to Oxlint", () => {
  expect(preferTildeImportsRule.createOnce).toBeTypeOf("function");
});
