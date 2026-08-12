import { expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Rule, Visitor } from "effect-oxlint";

it("certifies the fork pin and public compiler surface", async () => {
  const packageJson = JSON.parse(
    await readFile(join(import.meta.dirname, "../../package.json"), "utf8"),
  ) as {
    devDependencies: Record<string, string>;
  };

  expect(packageJson.devDependencies["effect-oxlint"]).toMatch(
    /^github:hadronomy\/effect-oxlint#[0-9a-f]{7,40}$/,
  );
  expect(Rule.plan).toBeTypeOf("function");
  expect(Rule.compile).toBeTypeOf("function");
  expect(Visitor.onSync).toBeTypeOf("function");
});
