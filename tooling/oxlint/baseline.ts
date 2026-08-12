import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(import.meta.dirname, "../..");
const vpPath = resolve(workspaceRoot, "node_modules/.bin/vp");
const baselineSeed = "effect-oxlint-baseline-v1";

const originalSource = [
  `import { value } from "../shared/value";`,
  `export { value as sharedValue } from "../shared/value";`,
  `export * from "../shared/value";`,
  `type Value = import("../shared/value").Value;`,
  `import valueModule = require("../shared/value");`,
  `void import("../shared/value");`,
  "void import(`../shared/value`);",
  `void require("../shared/value");`,
  `void require.resolve("../shared/value");`,
  `export * from "../shared/value?raw#section";`,
  `const part = "value";`,
  "void import(`../shared/${part}`);",
  `function local(require: (path: string) => unknown) { require("../shared/value"); }`,
  `void value; void valueModule; const typed: Value = 1; void typed; void local;`,
  "",
].join("\n");

export interface BaselineOptions {
  readonly samples?: number;
}

export interface BehaviorResult {
  readonly name: string;
  readonly changedOnFirstFix: boolean;
  readonly idempotentOnSecondFix: boolean;
  readonly outputBytes: number;
}

export interface TimingSummary {
  readonly samplesMs: readonly number[];
  readonly minimumMs: number;
  readonly medianMs: number;
  readonly maximumMs: number;
  readonly medianAbsoluteDeviationMs: number;
}

export interface BaselineReport {
  readonly schemaVersion: 1;
  readonly seed: typeof baselineSeed;
  readonly input: {
    readonly fileCount: number;
    readonly sourceBytes: number;
  };
  readonly behavior: readonly BehaviorResult[];
  readonly timing: TimingSummary;
}

const tsconfig = `{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "paths": { "~/*": ["./src/*"] }
  }
}`;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function timingSummary(samplesMs: readonly number[]): TimingSummary {
  const medianMs = median(samplesMs);
  const deviations = samplesMs.map((sample) => Math.abs(sample - medianMs));

  return {
    samplesMs,
    minimumMs: Math.min(...samplesMs),
    medianMs,
    maximumMs: Math.max(...samplesMs),
    medianAbsoluteDeviationMs: median(deviations),
  };
}

async function runLintFix(sourcePath: string): Promise<void> {
  await execFileAsync(vpPath, ["lint", "--fix", sourcePath], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      CI: "1",
      NO_COLOR: "1",
    },
  });
}

export async function runOxlintBaseline(options: BaselineOptions = {}): Promise<BaselineReport> {
  const samples = Math.max(1, Math.floor(options.samples ?? 3));
  const projectRoot = await mkdtemp(join(tmpdir(), "hadronomy-oxlint-baseline-"));
  const sourcePath = join(projectRoot, "src/pages/page.ts");

  try {
    await writeFile(join(projectRoot, "tsconfig.json"), tsconfig);
    await mkdir(join(projectRoot, "src/shared"), { recursive: true });
    await mkdir(join(projectRoot, "src/pages"), { recursive: true });
    await writeFile(join(projectRoot, "src/shared/value.ts"), "export const value = 1;\n");
    await writeFile(sourcePath, originalSource);

    await runLintFix(sourcePath);
    const firstFix = await readFile(sourcePath, "utf8");
    await runLintFix(sourcePath);
    const secondFix = await readFile(sourcePath, "utf8");
    const samplesMs: number[] = [];
    await runLintFix(sourcePath);

    for (let index = 0; index < samples; index += 1) {
      await writeFile(sourcePath, originalSource);
      const startedAt = process.hrtime.bigint();
      await runLintFix(sourcePath);
      const elapsedNs = process.hrtime.bigint() - startedAt;
      samplesMs.push(Number(elapsedNs) / 1_000_000);
    }

    return {
      schemaVersion: 1,
      seed: baselineSeed,
      input: {
        fileCount: 2,
        sourceBytes: Buffer.byteLength(originalSource),
      },
      behavior: [
        {
          name: "static-and-dynamic-module-references",
          changedOnFirstFix: firstFix !== originalSource,
          idempotentOnSecondFix: secondFix === firstFix,
          outputBytes: Buffer.byteLength(firstFix),
        },
      ],
      timing: timingSummary(samplesMs),
    };
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}
