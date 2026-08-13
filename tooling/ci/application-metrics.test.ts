import { expect, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const metricsScript = fileURLToPath(new URL("./record-application-metrics.sh", import.meta.url));

it("records reusable cache inputs and structured timing evidence", async () => {
  const directory = await mkdtemp(`${tmpdir()}/mze-application-metrics-`);
  const metricsPath = `${directory}/metrics.json`;
  const summaryPath = `${directory}/summary.md`;
  await writeFile(summaryPath, "");

  await execFileAsync(metricsScript, [metricsPath, summaryPath], {
    env: {
      ...process.env,
      BUN_CACHE_HIT: "true",
      BUN_CACHE_KEY: "bun-download-linux-amd64-lock",
      CHECK_SECONDS: "42",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_RUN_ID: "123",
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      INSTALL_SECONDS: "8",
      RUNNER_ARCH: "ARM64",
      RUNNER_OS: "Linux",
      VITE_CACHE_HIT: "false",
      VITE_CACHE_KEY: "vite-task-linux-arm64-inputs-pr-7",
    },
  });

  const [metrics, summary] = await Promise.all([
    readFile(metricsPath, "utf8"),
    readFile(summaryPath, "utf8"),
  ]);
  expect(metrics).toContain('"installSeconds": 8');
  expect(metrics).toContain('"checkSeconds": 42');
  expect(metrics).toContain('"default-branch"');
  expect(metrics).toContain('"matching-input-scope"');
  expect(summary).toContain("Bun cache key: bun-download-linux-amd64-lock");
  expect(summary).toContain("Vite+ imported scopes");
  expect(summary).toContain("Install seconds: 8");
});

it("keeps failure-run timing fields explicit when a command did not finish", async () => {
  const directory = await mkdtemp(`${tmpdir()}/mze-application-metrics-`);
  const metricsPath = `${directory}/metrics.json`;
  const summaryPath = `${directory}/summary.md`;
  await writeFile(summaryPath, "");

  await execFileAsync(metricsScript, [metricsPath, summaryPath], {
    env: { ...process.env, CHECK_SECONDS: "", INSTALL_SECONDS: "" },
  });

  const metrics = await readFile(metricsPath, "utf8");
  expect(metrics).toContain('"installSeconds": null');
  expect(metrics).toContain('"checkSeconds": null');
});
