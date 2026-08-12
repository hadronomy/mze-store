import { expect, test } from "vite-plus/test";

import { runOxlintBaseline } from "./baseline";

test(
  "records the current oxlint behavior and createOnce lifecycle",
  { timeout: 120_000 },
  async () => {
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
    expect(report.lifecycle.createOnceCalls).toBe(1);
    expect(report.lifecycle.beforeCalls).toBe(1);
    expect(report.lifecycle.afterCalls).toBe(1);
    expect(report.lifecycle.visitCalls).toBeGreaterThan(0);
    expect(report.timing.samplesMs).toHaveLength(1);
    expect(report.timing.medianMs).toBeGreaterThan(0);
  },
);
