import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Progress } from "./progress.ts";

it.effect("keeps JSON progress silent and returns the work value", () =>
  Effect.gen(function* () {
    const progress = yield* Progress.Service;
    const value = yield* progress.withProgress(
      { command: "services ports", message: "Reading service ports" },
      (update) =>
        Effect.gen(function* () {
          yield* update("Reading PostgreSQL");
          return 42;
        }),
    );

    expect(value).toBe(42);
  }).pipe(Effect.provide(Progress.layer("json"))),
);

it.effect("skips the spinner when stderr is not a terminal", () =>
  Effect.gen(function* () {
    const progress = yield* Progress.Service;
    const value = yield* progress.withProgress(
      { command: "services ports", message: "Reading service ports" },
      (update) => update("Reading PostgreSQL").pipe(Effect.as("ready")),
    );

    expect(value).toBe("ready");
  }).pipe(Effect.provide(Progress.layer("human", { tty: false }))),
);
