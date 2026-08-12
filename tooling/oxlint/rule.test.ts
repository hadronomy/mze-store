import { expect, it } from "@effect/vitest";

import { noBroadRecordTypesRule, preferTildeImportsRule } from "./rules.ts";

it("exports the compiled createOnce rule to Oxlint", () => {
  expect(preferTildeImportsRule.createOnce).toBeTypeOf("function");
  expect(noBroadRecordTypesRule.createOnce).toBeTypeOf("function");
});
