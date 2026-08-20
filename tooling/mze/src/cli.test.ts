import { expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, Path } from "effect";

import { repositoryRoot } from "./cli.ts";

it.effect("resolves the repository root from the CLI source directory", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    expect(repositoryRoot(path, "/repo/tooling/mze/src")).toBe("/repo");
  }).pipe(Effect.provide(NodeServices.layer)),
);
