import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Schema } from "effect";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const vpPath = resolve(workspaceRoot, "node_modules/.bin/vp");
const baselineSeed = "effect-oxlint-baseline-v2";

interface ReferenceCase {
  readonly name: string;
  readonly before: string;
  readonly after: string;
}

const referenceCases: readonly ReferenceCase[] = [
  {
    name: "import-declaration",
    before: `import { value } from "../shared/value";`,
    after: `import { value } from "~/shared/value";`,
  },
  {
    name: "named-export",
    before: `export { value as sharedValue } from "../shared/value";`,
    after: `export { value as sharedValue } from "~/shared/value";`,
  },
  {
    name: "export-all",
    before: `export * from "../shared/value";`,
    after: `export * from "~/shared/value";`,
  },
  {
    name: "typescript-import-type",
    before: `type Value = import("../shared/value").Value;`,
    after: `type Value = import("~/shared/value").Value;`,
  },
  {
    name: "typescript-import-equals",
    before: `import valueModule = require("../shared/value");`,
    after: `import valueModule = require("~/shared/value");`,
  },
  {
    name: "dynamic-import-string",
    before: `void import("../shared/value");`,
    after: `void import("~/shared/value");`,
  },
  {
    name: "dynamic-import-static-template",
    before: "void import(`../shared/value`);",
    after: "void import(`~/shared/value`);",
  },
  {
    name: "commonjs-require",
    before: `void require("../shared/value");`,
    after: `void require("~/shared/value");`,
  },
  {
    name: "commonjs-require-resolve",
    before: `void require.resolve("../shared/value");`,
    after: `void require.resolve("~/shared/value");`,
  },
  {
    name: "specifier-suffix",
    before: `export * from "../shared/value?raw#section";`,
    after: `export * from "~/shared/value?raw#section";`,
  },
];

const ignoredCases = [
  {
    name: "computed-dynamic-import",
    source: "void import(`../shared/${part}`);",
  },
  {
    name: "shadowed-require",
    source: `function local(require: (path: string) => unknown) { require("../shared/value"); }`,
  },
] as const;

const trailingSource = [
  `const part = "value";`,
  ...ignoredCases.map(({ source }) => source),
  `void value; void valueModule; const typed: Value = 1; void typed; void local;`,
  "",
];
const originalSource = [...referenceCases.map(({ before }) => before), ...trailingSource].join(
  "\n",
);
const expectedSource = [...referenceCases.map(({ after }) => after), ...trailingSource].join("\n");

const LintOutput = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      filename: Schema.String,
      labels: Schema.Array(
        Schema.Struct({
          span: Schema.Struct({
            column: Schema.Number,
            line: Schema.Number,
          }),
        }),
      ),
      message: Schema.String,
      severity: Schema.String,
    }),
  ),
});
const decodeLintOutput = Schema.decodeUnknownSync(Schema.fromJsonString(LintOutput));

export const createOnceContextContract = {
  setup: {
    available: ["decoded options", "static Layer services"],
    fileContextAvailable: false,
  },
  fileCallbacks: {
    phases: ["before", "effectful visitor", "synchronous visitor", "after"],
    properties: [
      "id",
      "filename",
      "physicalFilename",
      "cwd",
      "options",
      "sourceCode",
      "languageOptions",
      "settings",
      "report",
      "reportEffect",
    ],
  },
} as const;

export interface BaselineOptions {
  readonly samples?: number;
}

export interface BehaviorResult {
  readonly name: string;
  readonly diagnostic: {
    readonly code: string;
    readonly column: number;
    readonly line: number;
    readonly message: string;
    readonly severity: string;
  };
  readonly fix: {
    readonly before: string;
    readonly after: string;
  };
}

export interface TimingSummary {
  readonly samplesMs: readonly number[];
  readonly minimumMs: number;
  readonly medianMs: number;
  readonly maximumMs: number;
  readonly medianAbsoluteDeviationMs: number;
}

export interface BaselineReport {
  readonly schemaVersion: 2;
  readonly seed: typeof baselineSeed;
  readonly input: {
    readonly fileCount: number;
    readonly sourceBytes: number;
    readonly supportedReferenceCount: number;
  };
  readonly behavior: readonly BehaviorResult[];
  readonly ignored: ReadonlyArray<{
    readonly name: string;
    readonly unchanged: boolean;
  }>;
  readonly fix: {
    readonly changedOnFirstRun: boolean;
    readonly matchesExpectedOutput: boolean;
    readonly cleanOnSecondRun: boolean;
    readonly outputBytes: number;
  };
  readonly lifecycle: typeof createOnceContextContract;
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

function runVp(
  arguments_: readonly string[],
  acceptedExitCodes: readonly number[],
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      vpPath,
      arguments_,
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          CI: "1",
          NO_COLOR: "1",
        },
      },
      (error, stdout, stderr) => {
        const exitCode = Number(error?.code ?? 0);

        if (error && !acceptedExitCodes.includes(exitCode)) {
          rejectPromise(new Error(stderr || error.message, { cause: error }));
          return;
        }

        resolvePromise(stdout);
      },
    );
  });
}

async function runLintDiagnostics(sourcePath: string) {
  const stdout = await runVp(["lint", "--format", "json", sourcePath], [0, 1]);
  const diagnostics = decodeLintOutput(stdout).diagnostics;

  if (
    diagnostics.length !== referenceCases.length ||
    diagnostics.some(({ code }) => code !== "hadronomy(prefer-tilde-imports)")
  ) {
    throw new Error("The baseline received an unexpected diagnostic set.");
  }

  return diagnostics;
}

async function runLintFix(sourcePath: string): Promise<void> {
  await runVp(["lint", "--fix", sourcePath], [0]);
}

export async function runOxlintBaseline(options: BaselineOptions = {}): Promise<BaselineReport> {
  const samples = Math.max(1, Math.floor(options.samples ?? 3));
  const projectRoot = await mkdtemp(join(tmpdir(), "hadronomy-oxlint-baseline-"));
  const sourcePath = join(projectRoot, "src/pages/page.ts");

  try {
    await writeFile(join(projectRoot, "tsconfig.json"), tsconfig);
    await mkdir(join(projectRoot, "src/shared"), { recursive: true });
    await mkdir(join(projectRoot, "src/pages"), { recursive: true });
    await writeFile(
      join(projectRoot, "src/shared/value.ts"),
      "export const value = 1; export type Value = number;\n",
    );
    await writeFile(sourcePath, originalSource);

    const diagnostics = await runLintDiagnostics(sourcePath);
    await runLintFix(sourcePath);
    const firstFix = await readFile(sourcePath, "utf8");
    await runLintFix(sourcePath);
    const secondFix = await readFile(sourcePath, "utf8");
    const firstFixLines = firstFix.split("\n");
    const diagnosticsByLine = new Map(
      diagnostics.map((diagnostic) => [diagnostic.labels[0]?.span.line, diagnostic]),
    );
    const behavior = referenceCases.map(({ name, before }, index): BehaviorResult => {
      const line = index + 1;
      const diagnostic = diagnosticsByLine.get(line);

      if (!diagnostic) {
        throw new Error(`The baseline did not receive a diagnostic for ${name}.`);
      }

      return {
        name,
        diagnostic: {
          code: diagnostic.code,
          column: diagnostic.labels[0]?.span.column ?? 0,
          line,
          message: diagnostic.message,
          severity: diagnostic.severity,
        },
        fix: {
          before,
          after: firstFixLines[index] ?? "",
        },
      };
    });
    const samplesMs: number[] = [];

    for (let index = 0; index < samples; index += 1) {
      await writeFile(sourcePath, originalSource);
      const startedAt = process.hrtime.bigint();
      await runLintFix(sourcePath);
      const elapsedNs = process.hrtime.bigint() - startedAt;
      samplesMs.push(Number(elapsedNs) / 1_000_000);
    }

    return {
      schemaVersion: 2,
      seed: baselineSeed,
      input: {
        fileCount: 2,
        sourceBytes: Buffer.byteLength(originalSource),
        supportedReferenceCount: referenceCases.length,
      },
      behavior,
      ignored: ignoredCases.map(({ name, source }) => ({
        name,
        unchanged: firstFix.includes(source),
      })),
      fix: {
        changedOnFirstRun: firstFix !== originalSource,
        matchesExpectedOutput: firstFix === expectedSource,
        cleanOnSecondRun: secondFix === firstFix,
        outputBytes: Buffer.byteLength(firstFix),
      },
      lifecycle: createOnceContextContract,
      timing: timingSummary(samplesMs),
    };
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}
