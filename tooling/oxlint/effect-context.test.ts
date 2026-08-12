import { Effect } from "effect";
import type { Context as OxlintContext } from "@oxlint/plugins";
import { expect, test } from "vite-plus/test";

import {
  FileContext,
  FileContextClosed,
  FileContextUnavailable,
  makeController,
} from "./effect-context";

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

test("the file service rejects setup access and exposes one file frame", () => {
  const state: FakeState = {
    id: "hadronomy/rule",
    filename: "logical.ts",
    physicalFilename: "/repo/logical.ts",
    cwd: "/repo",
    reports: 0,
  };
  const controller = makeController(fakeContext(state));

  expect(() => controller.service.use(() => "setup")).toThrow(FileContextUnavailable);
  controller.before();

  const frame = controller.service.use((file) => file);
  expect(frame.filename).toBe("logical.ts");
  expect(frame.physicalFilename).toBe("/repo/logical.ts");
  frame.report({} as never);
  expect(state.reports).toBe(1);
});

test("closing a file invalidates retained reporting and opens the next frame", () => {
  const state: FakeState = {
    id: "hadronomy/rule",
    filename: "first.ts",
    physicalFilename: "/repo/first.ts",
    cwd: "/repo",
    reports: 0,
  };
  const controller = makeController(fakeContext(state));
  controller.before();
  const first = controller.service.use((file) => file);
  controller.close();

  expect(() => first.report({} as never)).toThrow(FileContextClosed);

  state.filename = "second.ts";
  state.physicalFilename = "/repo/second.ts";
  controller.before();
  expect(controller.service.use((file) => file.filename)).toBe("second.ts");
});

test("the service is available inside an Effect supplied by the adapter", () => {
  const state: FakeState = {
    id: "hadronomy/rule",
    filename: "logical.ts",
    physicalFilename: "/repo/logical.ts",
    cwd: "/repo",
    reports: 0,
  };
  const controller = makeController(fakeContext(state));
  controller.before();
  const fileName = Effect.runSync(
    Effect.gen(function* () {
      const file = yield* FileContext;
      return file.use((frame) => frame.physicalFilename);
    }).pipe(Effect.provideService(FileContext, controller.service)),
  );

  expect(fileName).toBe("/repo/logical.ts");
});

test("the file service rejects asynchronous callbacks", () => {
  const state: FakeState = {
    id: "hadronomy/rule",
    filename: "logical.ts",
    physicalFilename: "/repo/logical.ts",
    cwd: "/repo",
    reports: 0,
  };
  const controller = makeController(fakeContext(state));
  controller.before();

  expect(() => controller.service.use(async () => undefined)).toThrow(TypeError);
});
