import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { expect, test } from "@effect/vitest";

interface LintResult {
  readonly exitCode: number;
  readonly output: string;
}

const workspaceRoot = resolve(import.meta.dirname, "../..");
const vpPath = resolve(workspaceRoot, "node_modules/.bin/vp");

function runLint(filename: string): Promise<LintResult> {
  return new Promise((resolveResult) => {
    execFile(vpPath, ["lint", filename], { cwd: workspaceRoot }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;

      resolveResult({ exitCode, output: `${stdout}\n${stderr}` });
    });
  });
}

test("reports each broad record shape", { timeout: 30_000 }, async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "hadronomy-oxlint-records-"));
  const sourcePath = join(projectRoot, "src/types.ts");

  try {
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(
      sourcePath,
      [
        "export type UnknownRecord = Record<string, unknown>;",
        "export type AnyRecord = Record<string, any>;",
        "export type UnknownIndex = { [key: string]: unknown };",
        "export type NamedUnknownIndex = { [name: string]: unknown };",
        "",
      ].join("\n"),
    );

    const result = await runLint(sourcePath);

    expect(result.exitCode).toBe(1);
    expect(result.output.match(/hadronomy\(no-broad-record-types\)/g)).toHaveLength(4);
    expect(result.output).toContain("Record<string, unknown>");
    expect(result.output).toContain("Record<string, any>");
    expect(result.output).toContain("[key: string]: unknown");
    expect(result.output).toContain("named domain type with explicit fields");
    expect(result.output).toContain("Decode external input at the boundary");
    expect(result.output).toContain("no safe automatic fix exists");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("allows specific record value types", { timeout: 30_000 }, async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "hadronomy-oxlint-records-allowed-"));
  const sourcePath = join(projectRoot, "src/types.ts");

  try {
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(
      sourcePath,
      [
        "export type NumberRecord = Record<string, number>;",
        "export type AnyIndex = { [key: string]: any };",
        "",
      ].join("\n"),
    );

    const result = await runLint(sourcePath);

    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain("hadronomy(no-broad-record-types)");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
