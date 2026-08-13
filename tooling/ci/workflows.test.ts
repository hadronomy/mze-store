import { expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

type Permissions = Readonly<Record<string, string>>;

type Job = {
  readonly if?: string;
  readonly needs?: string | ReadonlyArray<string>;
  readonly permissions?: Permissions;
  readonly steps?: ReadonlyArray<{
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
