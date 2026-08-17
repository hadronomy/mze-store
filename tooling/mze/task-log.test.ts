import { expect, it } from "vite-plus/test";

import { TaskLog } from "./task-log.ts";

// Captured verbatim from `vp run --log grouped` against this workspace.
const STARTED = "[@mze-store/db#build] ~/packages/db$ vp pack ⊘ cache disabled";
const CACHE_HIT = "[@mze-store/oxlint#build] ~/tooling/oxlint$ vp pack ◉ cache hit, replaying";
const CACHE_MISS =
  "[@mze-store/db#build] ~/packages/db$ vp pack ○ cache miss: 'bun.lock' modified, executing";
const COMPOUND = "[@mze-store/auth#build] ~/packages/auth$ varlock codegen ⊘ cache disabled";
const FINISHED = "── [@mze-store/db#build] ──";

it("reads a task start, without its cache state", () => {
  expect(TaskLog.marker(STARTED)).toEqual({
    command: "vp pack",
    kind: "started",
    task: "@mze-store/db#build",
  });
  expect(TaskLog.marker(CACHE_HIT)).toMatchObject({ command: "vp pack", kind: "started" });
  expect(TaskLog.marker(CACHE_MISS)).toMatchObject({ command: "vp pack", kind: "started" });
  expect(TaskLog.marker(COMPOUND)).toMatchObject({
    command: "varlock codegen",
    task: "@mze-store/auth#build",
  });
});

it("reads a task end", () => {
  expect(TaskLog.marker(FINISHED)).toEqual({ kind: "finished", task: "@mze-store/db#build" });
});

it("matches after Vite+ has coloured the line", () => {
  expect(TaskLog.marker(`[1m${FINISHED}[22m`)).toEqual({
    kind: "finished",
    task: "@mze-store/db#build",
  });
});

it("ignores everything that is not a marker", () => {
  for (const line of [
    "ℹ entry: src/index.ts, src/schema/auth.ts",
    "✔ Build complete in 724ms",
    "src/failure-probe.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.",
    "vp run: 0/5 cache hit (0%), 3 failed.",
    "",
  ]) {
    expect(TaskLog.marker(line)).toBeUndefined();
  }
});

it("only yields a line once the chunk completing it arrives", () => {
  const first = TaskLog.takeLines("", "── [@mze-store/db#bu");

  expect(first.lines).toEqual([]);
  expect(TaskLog.marker(first.pending)).toBeUndefined();

  const second = TaskLog.takeLines(first.pending, "ild] ──\nℹ next\n");

  expect(second.lines).toEqual(["── [@mze-store/db#build] ──", "ℹ next"]);
  expect(second.pending).toBe("");
  expect(TaskLog.marker(second.lines[0]!)).toEqual({
    kind: "finished",
    task: "@mze-store/db#build",
  });
});
