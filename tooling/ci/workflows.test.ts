import { expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

type Permissions = Readonly<Record<string, string>>;

type Job = {
  readonly "continue-on-error"?: boolean;
  readonly if?: string;
  readonly needs?: string | ReadonlyArray<string>;
  readonly permissions?: Permissions;
  readonly steps?: ReadonlyArray<{
    readonly env?: Readonly<Record<string, boolean | number | string>>;
    readonly if?: string;
    readonly name?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly with?: Readonly<Record<string, boolean | number | string>>;
  }>;
};

type Workflow = {
  readonly concurrency?: {
    readonly "cancel-in-progress"?: boolean;
    readonly group?: string;
  };
  readonly jobs?: Readonly<Record<string, Job>>;
  readonly on?: Readonly<Record<string, null | { readonly branches?: ReadonlyArray<string> }>>;
  readonly permissions?: Permissions;
};

const readWorkflow = async (name: string): Promise<Workflow> =>
  parse(await readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8"));

const writePermissions = new Set(["attestations", "contents", "id-token", "packages"]);

it("keeps pull-request and merge-group validation read-only behind ci-gate", async () => {
  const workflow = await readWorkflow("ci.yml");

  expect(workflow.on).toHaveProperty("pull_request");
  expect(workflow.on).toHaveProperty("merge_group");
  expect(workflow.on).not.toHaveProperty("push");
  expect(workflow.permissions).toEqual({ contents: "read" });

  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const [permission, value] of Object.entries(job.permissions ?? {})) {
      if (writePermissions.has(permission)) expect(value).not.toBe("write");
    }

    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith("actions/checkout@")) {
        expect(step.with?.["persist-credentials"]).toBe(false);
      }
    }
  }

  const gate = workflow.jobs?.["ci-gate"];
  expect(gate?.if).toBe("${{ always() }}");
  expect(gate?.steps?.some((step) => step.name === "Require applicable checks")).toBe(true);
  expect(JSON.stringify(workflow)).not.toContain("pull_request_target");
  expect(JSON.stringify(workflow)).not.toContain("Browser test placeholder");
});

it("gives release writes only to trusted main jobs and never cancels an active release", async () => {
  const workflow = await readWorkflow("release.yml");

  expect(workflow.on).toMatchObject({ push: { branches: ["main"] } });
  expect(workflow.on).not.toHaveProperty("pull_request");
  expect(workflow.on).not.toHaveProperty("merge_group");
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);

  const writableJobs = Object.entries(workflow.jobs ?? {}).filter(([, job]) =>
    Object.values(job.permissions ?? {}).includes("write"),
  );
  expect(writableJobs.length).toBeGreaterThan(0);
  expect(writableJobs.every(([, job]) => job.if?.includes("refs/heads/main"))).toBe(true);

  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith("actions/checkout@")) {
        expect(step.with?.["persist-credentials"]).toBe(false);
      }
    }
  }
});

it("preserves informational Oxlint benchmark results as JSON", async () => {
  const workflow = await readWorkflow("ci.yml");
  const benchmark = workflow.jobs?.["oxlint-benchmark"];
  const source = JSON.stringify(benchmark);

  expect(benchmark?.["continue-on-error"]).toBe(true);
  expect(source).toContain("--outputJson");
  expect(source).toContain("oxlint-benchmark-${{ github.run_id }}-${{ github.run_attempt }}");
  expect(source).toContain("oxlint-benchmark.json");
  expect(source).toContain('"retention-days":90');
});

it("keys application caches by trusted inputs and reports their results", async () => {
  const ci = await readWorkflow("ci.yml");
  const release = await readWorkflow("release.yml");
  const serialized = JSON.stringify({ ci, release });

  expect(serialized).not.toContain('"path":"node_modules"');

  for (const job of [ci.jobs?.checks, release.jobs?.["release-checks"]]) {
    const steps = job?.steps ?? [];
    const bunCache = steps.find((step) => step.name === "Restore Bun download cache");
    const viteCache = steps.find((step) => step.name === "Restore Vite Task cache");
    const summary = steps.find((step) => step.name === "Report application check metrics");
    const evidence = steps.find((step) => step.name === "Preserve application check metrics");

    expect(bunCache?.with?.key).toContain("hashFiles('bun.lock')");
    expect(bunCache?.with?.key).not.toContain("github.run_id");
    expect(bunCache?.with?.key).not.toContain("github.run_attempt");
    expect(viteCache?.with?.key).toContain("runner.os");
    expect(viteCache?.with?.key).toContain("runner.arch");
    expect(viteCache?.with?.key).toContain("node24.18.1-bun1.3.14");
    expect(viteCache?.with?.key).toContain(
      "hashFiles('bun.lock', 'vite.config.ts', 'package.json', 'mise.toml')",
    );
    expect(viteCache?.with?.key).toContain("github.sha");
    expect(viteCache?.with?.["restore-keys"]).not.toContain("github.sha");
    expect(viteCache?.with?.key).not.toContain("github.run_id");
    expect(viteCache?.with?.key).not.toContain("github.run_attempt");
    expect(summary?.run).toContain("record-application-metrics.sh");
    expect(JSON.stringify(summary?.env)).toContain("cache-matched-key");
    expect(evidence?.with?.["retention-days"]).toBe(90);
  }

  const gate = ci.jobs?.["ci-gate"];
  expect(JSON.stringify(gate)).toContain("acceptedP95Seconds");
  expect(JSON.stringify(gate)).toContain("600");
  expect(JSON.stringify(gate)).toContain("ci-gate-metrics");
});
