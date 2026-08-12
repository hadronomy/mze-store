import { expect, test } from "vite-plus/test";
import { Effect } from "effect";
import type { Context as OxlintContext } from "@oxlint/plugins";

import { FileContext, fromOxlint, provide } from "./effect-context";

interface FakeState {
  id: string;
  filename: string;
  physicalFilename: string;
  cwd: string;
  reports: number;
}

function fakeContext(state: FakeState): OxlintContext {
  return {
    get id() {
      return state.id;
    },
    get options() {
      return [];
    },
    get filename() {
      return state.filename;
    },
    get physicalFilename() {
      return state.physicalFilename;
    },
    get cwd() {
      return state.cwd;
    },
    get sourceCode() {
      return {};
    },
    report() {
      state.reports += 1;
    },
  } as OxlintContext;
}

test("the file view reads the current host context on each access", () => {
  const state: FakeState = {
    id: "hadronomy/rule",
    filename: "logical.ts",
    physicalFilename: "/repo/logical.ts",
    cwd: "/repo",
    reports: 0,
  };
  const context = fakeContext(state);
  const file = fromOxlint(context);

  expect(file.filename).toBe("logical.ts");
  state.filename = "next.ts";
  state.physicalFilename = "/repo/next.ts";
  expect(file.filename).toBe("next.ts");
  expect(file.physicalFilename).toBe("/repo/next.ts");
  file.report({} as never);
  expect(state.reports).toBe(1);
});

test("the file view is available as an Effect service", () => {
  const state: FakeState = {
    id: "hadronomy/rule",
    filename: "logical.ts",
    physicalFilename: "/repo/logical.ts",
    cwd: "/repo",
    reports: 0,
  };
  const context = fakeContext(state);
  const fileName = Effect.runSync(
    provide(
      context,
      Effect.gen(function* () {
        return (yield* FileContext).physicalFilename;
      }),
    ),
  );

  expect(fileName).toBe("/repo/logical.ts");
});
