import { expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

type Permissions = Readonly<Record<string, string>>;

type Job = {
  readonly "continue-on-error"?: boolean;
  readonly if?: string;
  readonly needs?: string | ReadonlyArray<string>;
  readonly permissions?: Permissions;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, boolean | number | string>>;
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
  expect(compose).toContain('command: ["/app/node_modules/.bin/medusa", "db:migrate"]');
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
  expect(bake).toContain('tags       = ["${REGISTRY}/mze-store-medusa"]');
  expect(bake).toContain('tags       = ["${REGISTRY}/mze-store-storefront"]');
  expect(bake).not.toContain('tags       = ["${REGISTRY}/mze-store-medusa:${REVISION}"]');
  expect(bake).not.toContain('tags       = ["${REGISTRY}/mze-store-storefront:${REVISION}"]');
  expect(buildPolicy).toContain("docker image inspect");
  expect(buildPolicy).toContain("/app/node_modules/.bin/medusa db:migrate");
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
  expect(medusaDockerfile).toContain("--linker=hoisted");
  expect(medusaDockerfile).toContain("--backend=copyfile");
  expect(medusaDockerfile).toContain("-exec chmod go-w '{}' +");
  expect(medusaDockerfile).not.toContain("/app/node_modules/.bun");
  expect(medusaDockerfile).not.toContain("/app/apps/medusa/node_modules");
  expect(medusaDockerfile).toContain('CMD ["/app/node_modules/.bin/medusa", "start"]');
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

it("attests and verifies the exact trusted image index", async () => {
  const [ci, release, bake, evidenceCheck, provenanceInputCheck] = await Promise.all([
    readWorkflow("ci.yml"),
    readWorkflow("release.yml"),
    readRepositoryFile("docker-bake.hcl"),
    readRepositoryFile("tooling/ci/verify-build-evidence.sh"),
    readRepositoryFile("tooling/ci/verify-provenance-inputs.sh"),
  ]);
  const releasePolicy = `${JSON.stringify(release)}${bake}${evidenceCheck}${provenanceInputCheck}`;
  const pullRequestPolicy = JSON.stringify(ci);
  const imageBuildSteps = release.jobs?.["image-build"]?.steps ?? [];
  const imageIndexCheckout = release.jobs?.["image-index"]?.steps?.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  const imageIndexPermissions = release.jobs?.["image-index"]?.permissions;
  const inputCheckIndex = imageBuildSteps.findIndex(
    (step) => step.name === "Validate maximal provenance inputs",
  );
  const loginIndex = imageBuildSteps.findIndex((step) => step.name === "Log in to GHCR");
  const buildIndex = imageBuildSteps.findIndex(
    (step) => step.name === "Build the immutable candidate",
  );

  expect(bake).toContain('attest     = ["type=provenance,mode=max", "type=sbom"]');
  expect(imageIndexCheckout?.with?.["persist-credentials"]).toBe(false);
  expect(imageIndexPermissions?.actions).toBe("read");
  expect(inputCheckIndex).toBeGreaterThanOrEqual(0);
  expect(inputCheckIndex).toBeLessThan(loginIndex);
  expect(inputCheckIndex).toBeLessThan(buildIndex);
  expect(provenanceInputCheck).toContain("SOURCE_DATE_EPOCH");
  expect(releasePolicy).toContain("bash tooling/ci/verify-provenance-inputs.sh");
  expect(releasePolicy).toContain("bash tooling/ci/verify-build-evidence.sh");
  expect(releasePolicy).toContain(".Provenance");
  expect(releasePolicy).toContain(".SBOM");
  expect(releasePolicy).toContain("actions/attest-build-provenance@");
  expect(releasePolicy).toContain("gh attestation verify");
  expect(releasePolicy).toContain("--repo");
  expect(releasePolicy).toContain("GITHUB_REPOSITORY");
  expect(releasePolicy).toContain("id-token");
  expect(releasePolicy).toContain("attestations");
  expect(pullRequestPolicy).not.toContain("attest-build-provenance");
  expect(pullRequestPolicy).not.toContain('"id-token":"write"');
});

it("signs one verified digest before moving the main tag", async () => {
  const [ci, release] = await Promise.all([readWorkflow("ci.yml"), readWorkflow("release.yml")]);
  const trusted = JSON.stringify(release);
  const untrusted = JSON.stringify(ci);

  expect(trusted).toContain("sigstore/cosign-installer@");
  expect(trusted).toContain("cosign sign");
  expect(trusted).toContain("cosign verify");
  expect(trusted).toContain(
    "https://github.com/hadronomy/mze-store/.github/workflows/release.yml@refs/heads/main",
  );
  expect(trusted).toContain("https://token.actions.githubusercontent.com");
  expect(trusted).toContain("certificate-github-workflow-repository");
  expect(trusted).toContain("${IMAGE_REPOSITORY}@${DIGEST}");
  expect(trusted).toContain("Promote the signed digest to main");
  expect(trusted).toContain("${IMAGE_REPOSITORY}:main");
  expect(trusted).toContain("Publication target: 900 seconds");
  expect(untrusted).not.toContain("cosign sign");

  const steps = release.jobs?.["image-index"]?.steps ?? [];
  const signIndex = steps.findIndex((step) => step.name === "Sign the exact image index");
  const verifyIndex = steps.findIndex((step) => step.name === "Verify the image signature");
  const evidenceIndex = steps.findIndex((step) => step.name === "Upload release evidence");
  const promoteIndex = steps.findIndex((step) => step.name === "Promote the signed digest to main");
  expect(signIndex).toBeGreaterThan(-1);
  expect(verifyIndex).toBeGreaterThan(signIndex);
  expect(evidenceIndex).toBeGreaterThan(verifyIndex);
  expect(promoteIndex).toBeGreaterThan(evidenceIndex);
  expect(promoteIndex).toBe(steps.length - 1);
  expect(steps[promoteIndex]?.run).toContain('PROMOTED_DIGEST="$(docker buildx imagetools inspect');
  expect(steps[promoteIndex]?.run).toContain('test "$PROMOTED_DIGEST" = "$DIGEST"');
  expect(steps[promoteIndex]?.run?.trimEnd().endsWith("report_publication || true")).toBe(true);
});

it("runs advanced CodeQL through the trust boundary and stable gate", async () => {
  const [ci, codeql, ciSource, codeqlSource, codeqlActionSource] = await Promise.all([
    readWorkflow("ci.yml"),
    readWorkflow("codeql.yml"),
    readRepositoryFile(".github/workflows/ci.yml"),
    readRepositoryFile(".github/workflows/codeql.yml"),
    readRepositoryFile(".github/actions/run-codeql/action.yml"),
  ]);
  const pullRequestPolicy = JSON.stringify(ci.jobs?.codeql);
  const trustedPolicy = `${JSON.stringify(codeql)}${codeqlActionSource}`;

  expect(ci.jobs?.codeql?.permissions).toEqual({ actions: "read", contents: "read" });
  expect(pullRequestPolicy).toContain("javascript-typescript");
  expect(pullRequestPolicy).toContain("actions");
  expect(pullRequestPolicy).toContain("./.github/actions/run-codeql");
  expect(pullRequestPolicy).toContain('"upload":"never"');
  expect(ci.jobs?.["ci-gate"]?.needs).toContain("codeql");

  expect(codeql.on).not.toHaveProperty("workflow_call");
  expect(codeql.on).not.toHaveProperty("pull_request");
  expect(codeql.on).toMatchObject({ push: { branches: ["main"] } });
  expect(codeql.on).toHaveProperty("schedule");
  expect(trustedPolicy).toContain("javascript-typescript");
  expect(trustedPolicy).toContain("actions");
  expect(trustedPolicy).toContain("security-extended");
  expect(ciSource).toContain("upload: never");
  expect(codeqlSource).toContain("upload: always");
  expect(trustedPolicy).toContain("bash tooling/ci/enforce-codeql-policy.sh");
  expect(codeql.jobs?.["analyze-trusted"]?.permissions).toEqual({
    actions: "read",
    contents: "read",
    "security-events": "write",
  });

  for (const job of [ci.jobs?.codeql, ...Object.values(codeql.jobs ?? {})]) {
    const checkout = job.steps?.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  }

  const codeqlActions = codeqlActionSource.match(/github\/codeql-action\/[\w-]+@[^\s]+/gu) ?? [];
  expect(codeqlActions.length).toBeGreaterThan(0);
  expect(codeqlActions.every((action) => /@[a-f0-9]{40}$/u.test(action))).toBe(true);
});

it("blocks vulnerable dependency additions and reports licenses", async () => {
  const [ci, ciSource, reportSource] = await Promise.all([
    readWorkflow("ci.yml"),
    readRepositoryFile(".github/workflows/ci.yml"),
    readRepositoryFile("tooling/ci/report-dependency-review.sh"),
  ]);
  const review = ci.jobs?.["dependency-review"];
  const reviewPolicy = JSON.stringify(review);
  const reportPolicy = `${reviewPolicy}${reportSource}`;
  const checkout = review?.steps?.find((step) => step.uses?.startsWith("actions/checkout@"));

  expect(review?.permissions).toEqual({ contents: "read" });
  expect(checkout?.with?.["persist-credentials"]).toBe(false);
  expect(reviewPolicy).toContain("actions/dependency-review-action@");
  expect(reviewPolicy).toContain("bash tooling/ci/report-dependency-review.sh");
  expect(reviewPolicy).toContain('"fail-on-severity":"high"');
  expect(reviewPolicy).toContain('"fail-on-scopes":"runtime, development, unknown"');
  expect(reviewPolicy).toContain('"license-check":true');
  expect(reviewPolicy).not.toContain("allow-licenses");
  expect(reviewPolicy).not.toContain("deny-licenses");
  expect(reportPolicy).toContain("dependency-changes");
  expect(reportPolicy).toContain("Result: neutral");
  expect(reportPolicy).toContain("License");
  expect(ci.jobs?.["ci-gate"]?.needs).toContain("dependency-review");

  const dependencyActions = ciSource.match(/actions\/dependency-review-action@[^\s]+/gu) ?? [];
  expect(dependencyActions.length).toBe(1);
  expect(dependencyActions.every((action) => /@[a-f0-9]{40}$/u.test(action))).toBe(true);

  const checks = JSON.stringify(ci.jobs?.checks);
  expect(checks).toContain("bun install --frozen-lockfile");
  expect(checks).toContain("bun run check");
  expect(checks).toContain("bun run test");
});

it("publishes weekly Scorecard evidence with isolated OIDC permission", async () => {
  const [scorecard, scorecardSource, reportSource] = await Promise.all([
    readWorkflow("scorecard.yml"),
    readRepositoryFile(".github/workflows/scorecard.yml"),
    readRepositoryFile("tooling/ci/report-scorecard.sh"),
  ]);
  const policy = `${JSON.stringify(scorecard)}${reportSource}`;

  expect(scorecard.on).toHaveProperty("schedule");
  expect(scorecard.on).toHaveProperty("workflow_dispatch");
  expect(scorecard.on).not.toHaveProperty("push");
  expect(scorecard.on).not.toHaveProperty("pull_request");
  expect(scorecard.permissions).toEqual({ contents: "read" });
  expect(scorecard.jobs?.["publish-results"]?.permissions).toEqual({
    contents: "read",
    "id-token": "write",
    "security-events": "write",
  });
  expect(scorecard.jobs?.["report-evidence"]?.permissions).toEqual({ contents: "read" });

  expect(policy).toContain("ossf/scorecard-action@");
  expect(policy).toContain('"results_format":"sarif"');
  expect(policy).toContain('"publish_results":true');
  expect(policy).toContain("github/codeql-action/upload-sarif@");
  expect(policy).toContain("if-no-files-found");
  expect(policy).toContain("bash tooling/ci/report-scorecard.sh");
  expect(policy).toContain("security/code-scanning");
  expect(policy).toContain("?query=tool%3AScorecard");
  expect(scorecard.jobs?.["report-evidence"]?.if).toBe("${{ always() }}");
  expect(scorecard.jobs?.["report-evidence"]?.needs).toBe("publish-results");

  const scorecardActions = scorecardSource.match(/ossf\/scorecard-action@[^\s]+/gu) ?? [];
  expect(scorecardActions.length).toBe(1);
  expect(scorecardActions.every((action) => /@[a-f0-9]{40}$/u.test(action))).toBe(true);

  const jobsWithOidc = Object.entries(scorecard.jobs ?? {})
    .filter(([, job]) => job.permissions?.["id-token"] === "write")
    .map(([name]) => name);
  expect(jobsWithOidc).toEqual(["publish-results"]);
  expect(policy).not.toContain('"packages":"write"');
  expect(policy).not.toContain('"contents":"write"');
});
