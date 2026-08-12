import { expect, test } from "@effect/vitest";

import { runOxlintBaseline } from "./baseline";

test("records the current oxlint behavior and timing", { timeout: 120_000 }, async () => {
  const report = await runOxlintBaseline({ samples: 1 });

  expect(report.schemaVersion).toBe(1);
  expect(report.seed).toBe("effect-oxlint-baseline-v1");
  expect(report.input.fileCount).toBe(2);
  expect(report.behavior).toEqual([
    expect.objectContaining({
      name: "static-and-dynamic-module-references",
      changedOnFirstFix: true,
      idempotentOnSecondFix: true,
    }),
  ]);
  expect(report.timing.samplesMs).toHaveLength(1);
  expect(report.timing.medianMs).toBeGreaterThan(0);
});
