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
  readonly uses?: string;
  readonly with?: Readonly<Record<string, boolean | number | string>>;
};

type Workflow = {
  readonly concurrency?: {
    readonly "cancel-in-progress"?: boolean;
    readonly group?: string;
  };
  readonly jobs?: Readonly<Record<string, Job>>;
  readonly on?: Readonly<
    Record<
      string,
      | null
      | {
          readonly branches?: ReadonlyArray<string>;
          readonly paths?: ReadonlyArray<string>;
          readonly types?: ReadonlyArray<string>;
        }
      | ReadonlyArray<{ readonly cron: string }>
    >
  >;
  readonly permissions?: Permissions;
};

const readWorkflow = async (name: string): Promise<Workflow> =>
  parse(await readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8"));

const readRepositoryFile = (path: string): Promise<string> =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const writePermissions = new Set([
  "attestations",
  "contents",
  "id-token",
  "packages",
  "security-events",
]);

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

it("pins CI inputs and validates workflow and container definitions", async () => {
  const [ci, release, compose, medusa, storefront, dependabot] = await Promise.all([
    readWorkflow("ci.yml"),
    readWorkflow("release.yml"),
    readRepositoryFile("docker-compose.yml"),
    readRepositoryFile("apps/medusa/Dockerfile"),
    readRepositoryFile("apps/storefront/Dockerfile"),
    readRepositoryFile(".github/dependabot.yml"),
  ]);
  const workflows = JSON.stringify({ ci, release });

  expect(workflows).not.toContain("ubuntu-latest");
  expect(workflows).not.toContain("macos-latest");
  expect(workflows).toContain("ubuntu-24.04");
  expect(workflows).toContain("macos-15");
  expect(workflows).toContain("actionlint");
  expect(workflows).toContain("actionlint_1.7.7_linux_amd64.tar.gz");
  expect(workflows).not.toContain("actionlint_1.7.7_linux_x86_64.tar.gz");
  expect(workflows).toContain("shellcheck");
  expect(workflows).toContain("docker buildx build --check");

  expect(ci.jobs?.preflight?.needs).toEqual(["workflow-policy", "container-definitions"]);
  expect(ci.jobs?.preflight?.if).toBe("${{ always() }}");
  for (const job of [ci.jobs?.["workflow-policy"], ci.jobs?.["container-definitions"]]) {
    const checkout = job?.steps?.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  }
  for (const job of [ci.jobs?.checks, ci.jobs?.["tooling-live"], ci.jobs?.["docker-integration"]]) {
    expect(job?.needs).toBe("preflight");
  }

  expect(compose).toMatch(/postgres:18@sha256:[a-f0-9]{64}/u);
  expect(compose).toMatch(/redis:8-alpine@sha256:[a-f0-9]{64}/u);
  expect(workflows).toMatch(/node:24\.18\.1-bookworm@sha256:[a-f0-9]{64}/u);
  expect(dependabot).toContain("package-ecosystem: docker-compose");

  for (const dockerfile of [medusa, storefront]) {
    expect(dockerfile.startsWith("# syntax=docker/dockerfile:1.8\n# check=error=true\n")).toBe(
      true,
    );
  }
});

it("uses one Bake graph for local, pull-request, and release images", async () => {
  const [ci, release, bake] = await Promise.all([
    readWorkflow("ci.yml"),
    readWorkflow("release.yml"),
    readRepositoryFile("docker-bake.hcl"),
  ]);
  const workflows = JSON.stringify({ ci, release });

  expect(bake).toContain('target "medusa"');
  expect(bake).toContain('target "storefront"');
  expect(bake).toContain('group "ci"');
  expect(bake).toContain('group "release"');
  expect(bake).toContain("org.opencontainers.image.revision");
  expect(bake).toContain("cache-from");
  expect(bake).toContain("cache-to");
  expect(bake).toContain("type=gha,scope=mze-store-medusa-pr-${CACHE_SCOPE}");
  expect(bake).toContain("type=gha,scope=mze-store-storefront-pr-${CACHE_SCOPE}");
  expect(bake).toContain("type=gha,mode=max,scope=mze-store-medusa-main");
  expect(bake).toContain("type=gha,mode=max,scope=mze-store-storefront-main");
  expect(workflows).toContain("docker/bake-action@");
  expect(workflows).not.toContain("docker/build-push-action@");
});

it("builds and smokes exact platform digests on native runners", async () => {
  const [ci, release, bake, smoke] = await Promise.all([
    readWorkflow("ci.yml"),
    readWorkflow("release.yml"),
    readRepositoryFile("docker-bake.hcl"),
    readRepositoryFile("tooling/ci/smoke-image.sh"),
  ]);
  const buildPolicy = `${JSON.stringify({ ci, release, smoke })}${bake}`;
  const releaseCheckout = release.jobs?.["image-build"]?.steps?.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );

  expect(releaseCheckout?.with?.["persist-credentials"]).toBe(false);
  expect(buildPolicy).not.toContain("setup-qemu-action");
  expect(buildPolicy).toContain("ubuntu-24.04-arm");
  expect(buildPolicy).toContain("linux/arm64");
  expect(buildPolicy).toContain("push-by-digest=true");
  expect(buildPolicy).toContain("docker image inspect");
  expect(buildPolicy).toContain("/health");
  expect(buildPolicy).toContain("/app");
  expect(buildPolicy).toContain("imagetools create");
  expect(buildPolicy).toContain("@${DIGEST}");
  expect(bake).toContain("platforms  = [PLATFORM]");
});

it("enforces fixed image budgets and publishes complete scan evidence", async () => {
  const [ci, release, budgets, scanAction] = await Promise.all([
    readWorkflow("ci.yml"),
    readWorkflow("release.yml"),
    readRepositoryFile("tooling/ci/image-budgets.json"),
    readRepositoryFile(".github/actions/scan-image/action.yml"),
  ]);
  const policy = JSON.stringify({ ci, release, budgets, scanAction });

  expect(budgets).toContain('"compressedBytes": 90000000');
  expect(budgets).toContain('"uncompressedBytes": 285000000');
  expect(budgets).toContain('"compressedBytes": 230000000');
  expect(budgets).toContain('"uncompressedBytes": 900000000');
  expect(policy).toContain("tooling/ci/enforce-image-policy.sh");
  expect(policy).toContain("severity: HIGH,CRITICAL");
  expect(policy).toContain("--scanners misconfig,secret,license");
  expect(policy).toContain("--format sarif");
  expect(policy).toContain("trivy version --format json");
  expect(policy).not.toContain("trivy --version --format json");
  expect(policy).toContain("github/codeql-action/upload-sarif@");
  expect(policy).toContain("actions/upload-artifact@");
  expect(policy).toContain("${IMAGE_REPOSITORY}@${DIGEST}");
});

it("audits deterministic image output weekly and after build-chain changes", async () => {
  const [ci, release, audit, bake, comparison, detection, medusaDockerfile, storefrontDockerfile] =
    await Promise.all([
      readWorkflow("ci.yml"),
      readWorkflow("release.yml"),
      readWorkflow("reproducibility.yml"),
      readRepositoryFile("docker-bake.hcl"),
      readRepositoryFile("tooling/ci/compare-image-builds.sh"),
      readRepositoryFile("tooling/ci/detect-build-chain-changes.sh"),
      readRepositoryFile("apps/medusa/Dockerfile"),
      readRepositoryFile("apps/storefront/Dockerfile"),
    ]);
  const policy = JSON.stringify({
    ci,
    release,
    audit,
    bake,
    comparison,
    detection,
    medusaDockerfile,
    storefrontDockerfile,
  });

  expect(policy).toContain("SOURCE_DATE_EPOCH");
  expect(medusaDockerfile.match(/ARG SOURCE_DATE_EPOCH=0/g)).toHaveLength(2);
  expect(medusaDockerfile).toContain("update-browserslist-db@*/node_modules/.bin");
  expect(medusaDockerfile).toContain("ln -sfn ../browserslist/cli.js");
  expect(storefrontDockerfile.match(/ARG SOURCE_DATE_EPOCH=0/g)).toHaveLength(1);
  expect(bake.match(/rewrite-timestamp=true/g)).toHaveLength(4);
  expect(policy).toContain("git show --no-patch --format=%ct");
  expect(audit.on).toHaveProperty("schedule");
  expect(audit.on).toHaveProperty("workflow_call");
  expect(audit.on).not.toHaveProperty("pull_request");
  const auditCheckout = audit.jobs?.["image-reproducibility"]?.steps?.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  expect(auditCheckout?.with?.["persist-credentials"]).toBe(false);
  expect(policy).toContain("docker-bake.hcl");
  expect(policy).toContain("apps/.*/Dockerfile");
  expect(detection).toContain("(apps|packages|tooling)/.*/tsconfig[^/]*\\.json");
  expect(detection).toContain("(apps|packages|tooling)/.*/vite\\.config\\.[^/]+");
  expect(policy).toContain("docker/setup-buildx-action@");
  expect(policy).toContain("--allow=fs.write=/tmp");
  expect(policy).toContain("mkdir -p /tmp/audit-evidence");
  expect(policy).toContain("compare-image-builds.sh");
  expect(policy).toContain("normalize-storefront-output.mjs");
  expect(comparison).toContain("layers");
  expect(policy).toContain("actions/upload-artifact@");
  expect(JSON.stringify(audit)).toContain("github.run_attempt");
  expect(ci.jobs?.["image-reproducibility"]?.uses).toBe("./.github/workflows/reproducibility.yml");
  expect(ci.jobs?.["image-reproducibility"]?.needs).toBe("build-chain-changes");
  expect(ci.jobs?.["ci-gate"]?.needs).toContain("image-reproducibility");
  expect(audit.jobs?.["reproducibility-gate"]?.if).toBe("${{ always() }}");
  expect(JSON.stringify(audit.jobs?.["reproducibility-gate"])).toContain("Result: neutral");
});
