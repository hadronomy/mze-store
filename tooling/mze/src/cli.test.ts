import { expect, it } from "@effect/vitest";

import { repositoryRoot } from "./cli.ts";

it("resolves the repository root from the CLI source directory", () => {
  expect(repositoryRoot("/repo/tooling/mze/src")).toBe("/repo");
});
