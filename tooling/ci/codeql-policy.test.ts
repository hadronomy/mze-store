import { expect, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const policyScript = fileURLToPath(new URL("./enforce-codeql-policy.sh", import.meta.url));

type JsonValue =
  | boolean
  | number
  | string
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

const runPolicy = async (sarif: JsonValue): Promise<{ readonly report: string }> => {
  const directory = await mkdtemp(`${tmpdir()}/mze-codeql-policy-`);
  const reportPath = `${directory}/policy.json`;
  const sarifPath = `${directory}/results.sarif`;
  await writeFile(sarifPath, JSON.stringify(sarif));
  await execFileAsync("bash", [policyScript, reportPath, sarifPath]);
  return { report: await readFile(reportPath, "utf8") };
};

const sarifWithSeverity = (severity: string): JsonValue => ({
  runs: [
    {
      results: [
        {
          message: { text: "Unsafe data reaches a command." },
          ruleId: "js/example-query",
        },
      ],
      tool: {
        driver: {
          name: "CodeQL",
          rules: [
            {
              id: "js/example-query",
              properties: { "security-severity": severity },
            },
          ],
        },
      },
    },
  ],
  version: "2.1.0",
});

it("blocks high and critical CodeQL findings", async () => {
  await expect(runPolicy(sarifWithSeverity("7.0"))).rejects.toMatchObject({ code: 1 });
  await expect(runPolicy(sarifWithSeverity("9.0"))).rejects.toMatchObject({ code: 1 });
});

it("keeps medium CodeQL findings visible without blocking", async () => {
  const result = await runPolicy(sarifWithSeverity("6.9"));

  expect(result.report).toContain('"medium": 1');
  expect(result.report).toContain('"blocking": 0');
  expect(result.report).toContain("js/example-query");
});

it("fails closed for missing or malformed CodeQL output", async () => {
  await expect(runPolicy({ runs: [] })).rejects.toMatchObject({ code: 1 });
  await expect(runPolicy({ runs: [{ results: "invalid" }] })).rejects.toMatchObject({ code: 1 });
  await expect(
    runPolicy({
      runs: [
        {
          results: [{ message: { text: "orphan" }, ruleId: "js/missing" }],
          tool: { driver: { name: "CodeQL", rules: [] } },
        },
      ],
    }),
  ).rejects.toMatchObject({ code: 1 });
  await expect(runPolicy(sarifWithSeverity("not-a-number"))).rejects.toMatchObject({ code: 1 });
});
