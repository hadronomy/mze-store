import { expect, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const reportScript = fileURLToPath(new URL("./report-scorecard.sh", import.meta.url));

type JsonValue =
  | boolean
  | number
  | string
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

const runReport = async (sarif: JsonValue): Promise<string> => {
  const directory = await mkdtemp(`${tmpdir()}/mze-scorecard-report-`);
  const sarifPath = `${directory}/results.sarif`;
  const summaryPath = `${directory}/summary.md`;
  await Promise.all([writeFile(sarifPath, JSON.stringify(sarif)), writeFile(summaryPath, "")]);
  await execFileAsync("bash", [reportScript, sarifPath, "hadronomy/mze-store", summaryPath]);
  return readFile(summaryPath, "utf8");
};

const scorecardSarif = (results: JsonValue): JsonValue => ({
  runs: [
    {
      results,
      tool: {
        driver: {
          name: "Scorecard",
          rules: [
            {
              helpUri:
                "https://github.com/ossf/scorecard/blob/main/docs/checks.md#pinned-dependencies",
              id: "Pinned-Dependencies",
              properties: { "security-severity": "7.0" },
              shortDescription: { text: "Pinned dependencies" },
            },
          ],
        },
      },
    },
  ],
  version: "2.1.0",
});

it("links every reported Scorecard check to its documentation and evidence", async () => {
  const summary = await runReport(
    scorecardSarif([
      {
        message: { text: "score is 5: pin every dependency" },
        ruleId: "Pinned-Dependencies",
      },
    ]),
  );

  expect(summary).toContain("[Pinned dependencies](https://github.com/ossf/scorecard/");
  expect(summary).toContain(
    "https://github.com/hadronomy/mze-store/security/code-scanning?query=tool%3AScorecard+rule%3APinned-Dependencies",
  );
  expect(summary).toContain("[Open evidence]");
});

it("reports a clean Scorecard result", async () => {
  await expect(runReport(scorecardSarif([]))).resolves.toContain("No Scorecard findings");
});

it("fails closed when Scorecard evidence is malformed", async () => {
  await expect(runReport({ runs: [] })).rejects.toMatchObject({ code: 1 });
  await expect(
    runReport(scorecardSarif([{ message: { text: "orphan" }, ruleId: "Missing-Rule" }])),
  ).rejects.toMatchObject({ code: 1 });
});
