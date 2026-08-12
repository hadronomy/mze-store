import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Setup } from "./setup.ts";

it.effect("keeps JSON setup mode read-only", () =>
  Setup.requireWritableMode("json").pipe(
    Effect.flip,
    Effect.map((error) => {
      expect(error._tag).toBe("SetupRequiresInteractiveTerminal");
      expect(error.exitCode).toBe(1);
    }),
  ),
);
