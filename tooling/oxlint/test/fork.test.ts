import { expect, it } from "@effect/vitest";
import { FileContext, Rule, Visitor } from "effect-oxlint";

it("uses the forked Effect Oxlint API", () => {
  expect(FileContext.FileContext).toBeDefined();
  expect(Rule.defineOnce).toBeTypeOf("function");
  expect(Visitor.onSync).toBeTypeOf("function");
});
