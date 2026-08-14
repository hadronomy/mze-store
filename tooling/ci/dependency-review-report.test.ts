import { expect, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const reportScript = fileURLToPath(new URL("./report-dependency-review.sh", import.meta.url));

type JsonValue =
  | boolean
  | number
  | string
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

const runReport = async (changes: JsonValue): Promise<string> => {
  const directory = await mkdtemp(`${tmpdir()}/mze-dependency-review-`);
  const changesPath = `${directory}/changes.json`;
  const summaryPath = `${directory}/summary.md`;
  await Promise.all([writeFile(changesPath, JSON.stringify(changes)), writeFile(summaryPath, "")]);
  await execFileAsync("bash", [reportScript, changesPath, summaryPath]);
  return readFile(summaryPath, "utf8");
};

it("reports a deliberate neutral result without dependency changes", async () => {
  await expect(runReport([])).resolves.toContain("Result: neutral");
});

it("reports dependency licenses without turning them into policy", async () => {
  const summary = await runReport([
    {
      license: "MIT OR Apache-2.0",
      name: "example|package",
      scope: "development",
      version: "1.2.3",
    },
    {
      license: null,
      name: "unknown-license",
      version: "4.5.6",
    },
  ]);

  expect(summary).toContain("License findings are report-only");
  expect(summary).toContain("example\\|package");
  expect(summary).toContain("development");
  expect(summary).toContain("unknown-license | 4.5.6 | unknown | unknown");
});

it("fails closed for malformed dependency analysis", async () => {
  await expect(runReport({ changes: [] })).rejects.toMatchObject({ code: 1 });
  await expect(runReport([{ name: "incomplete" }])).rejects.toMatchObject({ code: 1 });
});
