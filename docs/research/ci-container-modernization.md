# CI and container modernization

Date: 2026-08-13
Scope: GitHub Actions, task caching, Docker images, image release, and Earthly
Repository: `hadronomy/mze-store`

## Decision summary

Keep the current ownership boundaries:

- Vite+ owns the application task graph. It runs formatting, linting, tests, and workspace builds.
- GitHub Actions orchestrates checks, security jobs, Docker builds, and release evidence.
- Docker BuildKit, Buildx, and Bake own image construction, cache export, multi-platform output, and image attestations.
- Medusa remains the commerce and Operator admin boundary. The Storefront continues to call Medusa under `/store/*`.
- Node remains the runtime. Bun remains the package manager. The versions remain Node `24.18.1` and Bun `1.3.14`.

Do not add Earthly. Its official project repository now states that Earthly is no longer actively maintained. Earthly Cloud stopped on 2025-07-16, and the open-source project receives only critical fixes. Use Docker Bake for the two container targets. Cite: [Earthly repository](https://github.com/earthly/earthly), [Earthly shutdown announcement](https://earthly.dev/blog/shutting-down-earthfiles-cloud), [Docker Bake](https://docs.docker.com/build/bake/).

The accepted performance targets are:

- P95 first blocking result within 3 minutes.
- P95 merge-ready result within 10 minutes.
- P95 documentation-only result within 2 minutes.
- P95 multi-platform `main` candidate within 15 minutes.

The accepted image budgets are:

| Image      | Compressed | Uncompressed |
| ---------- | ---------: | -----------: |
| Storefront |      90 MB |       285 MB |
| Medusa     |     230 MB |       900 MB |

A budget change needs explicit review. An Actions cache cannot own these limits.

The highest-value changes are:

1. Make one stable, always-running `ci-gate` required check. Add `merge_group` to the workflow. Make every applicable check block that gate.
2. Separate untrusted pull-request checks from main-branch image publication. Remove the permanent owner bypass from the `main` ruleset.
3. Fix the Vite+ cache key. The current key contains `github.run_id`, so each run misses the exact cache entry. Key it by the lockfile, task configuration, runtime versions, operating system, and architecture.
4. Add actionlint, dependency review, advanced CodeQL, and a scheduled Scorecard review. Keep each job narrow and give it only the permissions that it needs.
5. Build both image platforms on native GitHub runners. Scan, test, attest, sign, and publish the same digest.
6. Add BuildKit SPDX and provenance attestations, GitHub artifact attestations, and keyless Cosign signatures.
7. Measure cache hit rate, queue time, P95 check time, image size, vulnerability counts, and attestation verification against the accepted budgets.

This order gives security and merge correctness before speed tuning. It also keeps the repository within ADR-0023: Vite+ remains the only task runner.

## Evidence and local architecture

I inspected:

- [`CONTEXT.md`](../../CONTEXT.md)
- [`docs/architecture.md`](../architecture.md)
- the relevant records in [`docs/adr/`](../adr/), including ADR-0001, ADR-0006, ADR-0023, and ADR-0024
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
- [`.github/dependabot.yml`](../../.github/dependabot.yml)
- [`apps/medusa/Dockerfile`](../../apps/medusa/Dockerfile)
- [`apps/storefront/Dockerfile`](../../apps/storefront/Dockerfile)
- [`docker-compose.yml`](../../docker-compose.yml)
- [`package.json`](../../package.json)
- [`vite.config.ts`](../../vite.config.ts)
- [`mise.toml`](../../mise.toml)
- [`docs/research/docker-image-optimization.md`](docker-image-optimization.md)

The domain vocabulary in `CONTEXT.md` matters here. CI validates the Storefront, Medusa, Operator, and the pure-TS packages. It does not create a second commerce API or a second task runner. A CI failure is a failed repository check, not a new domain concept.

### Current workflow

The current workflow has these jobs:

| Job                | Current role                                                                             | Assessment                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `checks`           | Install with Bun, restore Vite+ task cache, run `bun run check` and `bun run test`       | Core gate. The task cache key needs correction. There is no separate dependency cache.                                                   |
| `oxlint-benchmark` | Run the private Oxlint benchmark and write a summary                                     | Useful informational signal. It is not a merge gate. Keep it separate from correctness.                                                  |
| `tooling-live`     | Run live tooling tests on Ubuntu and macOS, including a Node container test on Ubuntu    | Good operating-system coverage. The container test uses a mutable `node:24.18.1-bookworm` tag.                                           |
| `docker`           | Build and start Compose services, wait for health, check Medusa and Storefront endpoints | Good integration signal. Compose uses floating `postgres:18` and `redis:8-alpine` tags.                                                  |
| `docker-images`    | Build local pull-request images. Build, push, scan, and promote main images.             | Strong baseline. It combines pull-request and release permissions and has no GitHub artifact-attestation step.                           |
| `browser`          | Run `bun run test:e2e` and upload traces                                                 | The workflow calls this a placeholder. A placeholder must not be a required gate. Implement it or remove it from the required-check set. |

The workflow already uses full commit SHA pins, a read-only global `GITHUB_TOKEN`, stale-run cancellation, timeouts, a live-test matrix, and Docker health checks. It also uses BuildKit cache mounts, multi-stage images, non-root runtime users, and immutable SHA image tags. These are strong starting points.

The live repository settings add these facts:

- CodeQL default setup scans GitHub Actions and JavaScript/TypeScript. One high alert and one medium alert are open.
- Secret scanning and push protection are active.
- Private vulnerability reporting, secret validity checks, and non-provider secret patterns are inactive.
- Actions permit every source. Repository settings do not enforce SHA pins.
- The `main` ruleset requires `Types, lint, and tests` and `Docker smoke test`. It gives the owner a permanent bypass.
- The repository has no protected deployment environment.

The existing Dockerfiles copy manifests before the dependency install and copy source after that install. The older image optimization note says that both Dockerfiles copy all source before `bun install`. That statement is stale relative to the checked files. Keep the current manifest-first order.

### Measured baseline

Recent successful runs give a comparison baseline. These samples are not a P95 calculation.

| Event and run                                                                               | Required checks complete | Full workflow | Storefront image job | Medusa image job |
| ------------------------------------------------------------------------------------------- | -----------------------: | ------------: | -------------------: | ---------------: |
| Pull request [31728843620](https://github.com/hadronomy/mze-store/actions/runs/31728843620) |                   2m 52s |        8m 57s |               4m 13s |           6m 02s |
| Pull request [31729983451](https://github.com/hadronomy/mze-store/actions/runs/31729983451) |                   3m 41s |       10m 51s |               3m 53s |           7m 04s |
| Main [31629176879](https://github.com/hadronomy/mze-store/actions/runs/31629176879)         |                   2m 35s |       16m 54s |               7m 24s |          14m 11s |

The current dependency install usually takes 7 to 18 seconds. Docker work owns most of the remaining critical path. The main image jobs start only after application, tooling, and Compose checks finish.

The successful main run recorded these image sizes:

| Image and platform | Compressed bytes | Uncompressed bytes |
| ------------------ | ---------------: | -----------------: |
| Storefront amd64   |       81,016,247 |        237,152,059 |
| Storefront arm64   |       80,566,519 |        255,618,801 |
| Medusa amd64       |      206,991,696 |        813,526,118 |
| Medusa arm64       |      202,397,442 |        817,052,214 |

The accepted absolute budgets leave a small Storefront margin and a larger Medusa margin. Report bytes and rounded megabytes in each future workflow summary.

## Target workflow shape

Use four workflows with stable job names and separate permission domains.

```text
ci.yml
pull_request ─┐
merge_group ──┴─> prepare / changed-scope decision
                        ├─> checks
                        ├─> tooling-live (Ubuntu, macOS)
                        ├─> actionlint / dependency-review
                        ├─> native image validation (amd64, arm64)
                        └─> ci-gate (always runs and required)

release.yml
push: main ────────────> native image build by platform
                         ├─> scan and smoke each platform digest
                         ├─> assemble the image index
                         ├─> BuildKit and GitHub attestations
                         ├─> keyless Cosign sign and verify
                         └─> promote the verified index digest to `main`

codeql.yml
pull_request / merge_group / push: main / weekly ──> advanced CodeQL

scorecard.yml
weekly ───────────────────────────────────────────> OpenSSF Scorecard
```

The graph above is a policy shape, not a request to add a second task runner. Let Vite+ decide task order inside `checks`. Let Buildx decide Docker build order inside the image jobs.

### Stable checks and merge queue

GitHub requires a workflow that uses a merge queue to include the `merge_group` event. Without it, required checks do not report for the temporary merge-group reference and the queue cannot merge the pull request. Cite: [GitHub merge queue events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [GitHub merge queue configuration](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue?apiVersion=2022-11-28).

Add `merge_group` beside `pull_request` and `push`. Use stable job names that do not depend on a branch name or a matrix value for the gate. Protected branches require unique check names. A skipped check can remain pending and block a pull request when it is required. Use an always-running aggregator for required policy, and let it report failure when an applicable job fails. Cite: [protected branch required checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [workflow path and branch filters](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

Recommended policy:

- `checks`, `tooling-live`, `docker-integration`, and image validation are required for changes that touch their scope.
- A `ci-gate` job always runs. It lists every applicable result and fails when any applicable result is not successful.
- A changed-scope decision does not silently turn a required check into a skipped check. For an out-of-scope job, report a deliberate neutral result through the gate.
- Keep the job names stable across pull requests, pushes, and merge groups.
- Remove `browser`. Add the job again when `bun run test:e2e` runs a real Storefront suite.

GitHub's concurrency model permits one running and one pending run per concurrency group. The current `github.workflow-github.ref` group and `cancel-in-progress: true` are appropriate for pull requests. Use a separate release group for main so a newer push cannot cancel a publication after it has started. Cite: [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

### Pull-request trust boundary

Keep untrusted pull requests on `pull_request`. GitHub gives fork pull requests a read-only token and does not pass secrets. `pull_request_target` runs in the base repository context and can expose write permissions or secrets if it checks out and executes the pull-request head. GitHub documents this as the `pwn request` risk. Do not execute untrusted code on a self-hosted runner. Cite: [secure use of `pull_request_target`](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target), [events and fork permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [GitHub Actions security hardening](https://docs.github.com/en/actions/how-tos/secure-your-work).

Split `docker-images` into two permission domains:

- `docker-image-pr` has `contents: read`. It builds on native amd64 and arm64 runners. It imports only trusted or pull-request-scoped caches. It scans and smokes each local image. It does not log in to GHCR, push, or attest.
- `image-publish` runs only on a trusted `push` to `main`. It grants `packages: write`, `id-token: write`, and `attestations: write` at job scope. It builds and pushes by platform digest. It scans and smokes each digest. It assembles, attests, signs, verifies, and promotes the index digest.

A workflow-level `contents: read` is a good default. Keep write permissions at the smallest job that needs them. When a workflow declares any `permissions` block, unspecified permissions become `none`. Cite: [workflow permissions syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [GITHUB_TOKEN permissions](https://docs.github.com/en/actions/concepts/security/github_token).

Pass untrusted GitHub context fields to an environment variable rather than interpolating them into shell source. Branch names, issue titles, and other context values can contain shell syntax. Run actionlint and ShellCheck checks on every workflow change. Cite: [GitHub script injection guidance](https://docs.github.com/en/actions/concepts/security/script-injections), [actionlint](https://github.com/rhysd/actionlint).

### Action pinning and allowlist

Keep full 40-character SHA pins. GitHub identifies a full commit SHA as the only immutable action reference. Dependabot can update a SHA when the same line contains the action release comment. Cite: [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use), [Dependabot action updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions).

Enforce SHA pins in repository settings. Replace the allow-all action policy with reviewed repository entries. Allow only the actions used by the four workflows:

- `actions/checkout`, `actions/setup-node`, and `oven-sh/setup-bun` for source and tool setup.
- `actions/cache`, `actions/upload-artifact`, and `actions/download-artifact` for cache and evidence transfer.
- `actions/dependency-review-action` and `actions/attest-build-provenance` for dependency and release evidence.
- `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, and `docker/bake-action` for image release.
- `aquasecurity/trivy-action` for image scanning.
- `github/codeql-action` only for CodeQL and SARIF upload.
- `ossf/scorecard-action` only for the scheduled supply-chain check.
- `sigstore/cosign-installer` only for keyless image signing and verification.

Pin every new action to a verified SHA. Keep the release comment beside the pin. An allowlist is a review control, not a replacement for pin verification.

## Cache design

### Vite+ task cache

The current `checks` cache key is:

```text
vite-task-${runner.os}-${runner.arch}-${github.run_id}-${github.run_attempt}
```

The run ID makes each exact key unique. The restore prefix can reuse an older cache, but the cache never gets a stable exact hit for the same source state. Replace it with a key that changes when inputs change:

```text
vite-task-${runner.os}-${runner.arch}-node24.18.1-bun1.3.14-${hashFiles('bun.lock','vite.config.ts','package.json','mise.toml')}
```

Use a version prefix when the cache layout changes. Include the OS and architecture. Include files that alter task graph behavior. Let the lockfile control dependency state. Do not include `github.run_id`.

GitHub's cache service uses an exact key first, then restore-key prefixes. Caches are scoped by branch and repository rules. Pull-request runs can restore caches from the base branch. Treat restored cache data as untrusted and never place secrets in a cache. Cite: [dependency caching](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching), [cache reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

Keep the Vite+ cache path `node_modules/.vite/task-cache`. Pull requests can read the trusted `main` cache and write only a pull-request-scoped cache. Release jobs must not import a pull-request cache. A cache is an optimization. A clean run must remain correct without it.

### Bun dependency cache

Add a separate cache for Bun's download cache, not for `node_modules`:

```text
${{ runner.os }}-${{ runner.arch }}-node24.18.1-bun1.3.14-bun-${{ hashFiles('bun.lock') }}
```

Use the exact path produced by Bun on the runner. Confirm the path with `bun pm cache` in the workflow before committing the cache path. Keep `bun install --frozen-lockfile` as the source of truth. Do not cache `.env` files, credentials, Docker auth files, or generated application output.

### BuildKit cache

BuildKit external caches make ephemeral CI builders useful. Docker documents registry and GitHub Actions cache backends. `mode=min` exports the final-result layers. `mode=max` exports intermediate layers and usually gives more reuse at a larger cache size. Use one cache scope per image so `medusa` and `storefront` do not overwrite each other. Cite: [BuildKit cache backends](https://docs.docker.com/build/cache/backends/), [GitHub Actions cache backend](https://docs.docker.com/build/cache/backends/gha/).

Accepted policy:

- Pull request: build `linux/amd64` and `linux/arm64` on native runners. Import the trusted default-branch cache and a PR-scoped cache. Export a PR-scoped cache with `mode=min`.
- Main release: build both platforms on native runners. Import only the trusted registry cache for that image. Export a registry cache with a stable image-specific scope and `mode=max`.
- Never import a cache written by an untrusted pull request into a release build.
- Record whether each cache import hit. A successful build with no cache hit is not a cache success.
- Give each image a distinct cache scope, such as `mze-medusa` and `mze-storefront`.

The current workflow uses a PR local baseline cache and an image-specific GHA scope. Keep the separation, but remove run-specific task keys and make the trust direction explicit.

## Docker and BuildKit

### Dockerfile strengths

Both images already use the important patterns:

- multi-stage builds.
- digest-pinned Bun and Node base images.
- manifest-first dependency installation.
- Bun cache mounts during install.
- a filtered production dependency install for Medusa.
- small Node bookworm-slim runtime images.
- non-root `node` users.
- only the runtime output and required dependencies copied into the final stage.

Docker recommends multi-stage builds, small runtime images, digest pins, regular rebuilds, a `.dockerignore`, and a non-root `USER`. It recommends `--pull` when a build needs fresh base-image resolution. Cite: [Docker build best practices](https://docs.docker.com/build/building/best-practices/).

Keep Debian-based runtime images. Medusa and its native dependencies already use the Debian family. Do not switch to Alpine for size alone. An Alpine switch changes the C library and requires a separate compatibility test.

### Build checks and syntax

The Dockerfiles use `# syntax=docker/dockerfile:1.8`. Docker Build checks are built into current Buildx releases. The checks can run as a dedicated check, and `# check=error=true` turns warnings into build failures. Docker recommends pinning the Dockerfile syntax when enabling error mode because new checks can otherwise change a build result. Cite: [Docker build checks](https://docs.docker.com/reference/build-checks/), [Docker build checks guide](https://docs.docker.com/build/checks/).

The implementation validates both Dockerfiles with the repository's Buildx version and enables error mode. Compose also runs its native configuration validation.

### Buildx and Bake

Buildx's `docker-container` driver supports multi-platform builds and external caches. The Docker Buildx GitHub Actions are the supported integration for setup, QEMU, metadata, cache, attestations, and image output. Cite: [setup-buildx-action](https://github.com/docker/setup-buildx-action), [Docker GitHub Actions](https://docs.docker.com/build/ci/github-actions/).

Add a small `docker-bake.hcl` for the repeated platform, tag, cache, label, and attestation wiring. Bake provides declarative targets, groups, and concurrent execution without changing the Dockerfiles. It is a Buildx feature, not a second application task runner. Cite: [Docker Bake](https://docs.docker.com/build/bake/), [Buildx Bake reference](https://docs.docker.com/reference/cli/docker/buildx/bake/).

The first Bake file can define:

- `medusa` and `storefront` targets.
- a `ci` group for pull-request amd64 and arm64 builds.
- a `release` group for both Linux platforms.
- image-specific cache scopes.
- OCI revision, source, version, and created labels.
- output and attestation settings.

Do not move `bun run check`, `bun run test`, or workspace build tasks into Bake. Vite+ remains their owner.

### Multi-platform release

The current main job uses QEMU to build `linux/amd64` and `linux/arm64`. The accepted design replaces emulation with `ubuntu-24.04` and `ubuntu-24.04-arm`. Standard GitHub-hosted runners are free and unlimited for this public repository. The arm64 label is in public preview. Cite: [GitHub runner selection](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job), [Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/).

Build each platform on its native runner. Test both images on both platforms for:

- manifest presence.
- image pull.
- non-root runtime user.
- `/health` and `/app` responses.
- the Medusa migration and Redis/PostgreSQL health path.

The current workflow measures image size but does not run the arm64 image. A manifest check is not an arm64 runtime check. Each native job must scan and smoke the exact platform digest that the release index references.

### Tags, digests, and promotion

Build and push the release image by digest. Capture the digest output from Buildx. Scan and attest that digest. Promote the same digest to a human-readable tag with `imagetools create`. Do not rebuild for the `main` tag. The current immutable SHA tag and `imagetools` promotion pattern is the right shape. Make the digest the release record in the job summary and artifact.

Use `docker/metadata-action` for consistent OCI labels and tags. Keep the commit SHA tag immutable. Add a short release tag only after the digest passes all applicable gates. Cite: [Docker metadata action](https://github.com/docker/metadata-action), [Docker image attestation workflow](https://docs.docker.com/build/ci/github-actions/attestations/).

### Reproducibility

BuildKit supports reproducible-build controls, including `SOURCE_DATE_EPOCH`, reproducible timestamps, and provenance metadata. The value must come from a trusted commit timestamp in the release job. Rebuild the same source with the same base-image digests and lockfile, then compare the image index and layer digests. Cite: [Docker reproducible builds](https://docs.docker.com/build/ci/github-actions/reproducible-builds/), [BuildKit reproducible builds](https://github.com/moby/buildkit/blob/master/docs/build-repro.md).

Run this comparison weekly. Also make it a blocking check for Dockerfile, Bake, base-image, and build-chain changes. Regular application changes do not need a duplicate build.

Do not put credentials in `ARG` or `ENV`. BuildKit provenance in `mode=max` includes rich build metadata and can expose build-argument values. Use BuildKit secret mounts for secrets, and keep secrets out of image layers and provenance. Cite: [BuildKit provenance](https://github.com/moby/buildkit/blob/master/docs/attestations/slsa-provenance.md), [Docker attestation guidance](https://docs.docker.com/build/ci/github-actions/attestations/).

Use `--pull` in a scheduled rebuild or a deliberate base-image update workflow. A daily rebuild that silently resolves a new floating tag conflicts with reproducible digest-pinned images. Update base-image digests through Dependabot and test the resulting pull request.

## Image security evidence

### BuildKit attestations and GitHub attestations

BuildKit can attach an SPDX SBOM and in-toto provenance to the image index. Provenance has a minimal and a maximal mode. SBOM generation is opt-in in the Docker GitHub Actions. Cite: [Docker attestations](https://docs.docker.com/build/metadata/attestations/), [Docker SBOM attestations](https://docs.docker.com/build/metadata/attestations/sbom/).

Keep BuildKit provenance and SBOM enabled for published images. Use `mode=max` only after checking the metadata for source paths, build arguments, and other repository details.

Also create a GitHub artifact attestation for each pushed image digest. GitHub's container example grants `contents: read`, `id-token: write`, `attestations: write`, and `packages: write`, then attests the image name and digest. Verify the result with `gh attestation verify`. Cite: [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

Run artifact attestation only in the trusted publication job. A pull-request job has no reason to mint a release provenance claim.

### Cosign signatures

Sign the final image-index digest with keyless Cosign after every platform digest passes its scan and smoke test. Cosign uses a short-lived certificate from the GitHub Actions OIDC identity. It stores the signature with the image in GHCR and records the signing event in Rekor. No private signing key exists. Cite: [Cosign repository](https://github.com/sigstore/cosign), [Sigstore keyless signing](https://docs.sigstore.dev/cosign/signing/overview/).

The accepted signer policy is:

- workflow identity: `https://github.com/hadronomy/mze-store/.github/workflows/release.yml@refs/heads/main`.
- OIDC issuer: `https://token.actions.githubusercontent.com`.
- repository: `hadronomy/mze-store`.
- signed object: the multi-platform image-index digest.

Install Cosign through `sigstore/cosign-installer` at a full commit SHA. Grant `id-token: write` only to the trusted signing job. Verify the expected certificate identity and issuer before `imagetools create` moves the `main` tag. A signing or verification failure stops promotion. Cite: [Cosign verification](https://docs.sigstore.dev/cosign/verifying/verify/), [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc).

Do not create duplicate Cosign SBOM or provenance attestations. BuildKit owns the SPDX SBOM and in-toto provenance. GitHub owns the repository artifact attestation. Cosign signs the image index.

Minisign is not part of this release path. It signs files with a long-lived Ed25519 key, but it has no native OCI identity, registry storage, or transparency record. Cite: [Minisign repository](https://github.com/jedisct1/minisign).

### Vulnerability and configuration scans

The current workflow runs Trivy against each image and blocks fixable `CRITICAL` findings while reporting other findings. Expand the gate to block every fixable critical finding and each new fixable high finding. Scan each final platform image by digest, not a mutable tag.

Add separate outputs:

- a human-readable table in the job log.
- JSON as a uniquely named artifact for each image and platform.
- SARIF for GitHub code scanning when the job has the required `security-events: write` permission.
- a summary with image digest, scanner version, database date, total findings, fixable findings, and the blocking count.

Trivy supports an exit-code gate, severity selection, ignored-unfixed findings, scanner selection, and SARIF output. Its default exit code is zero, so a policy must set the exit code explicitly. Cite: [Trivy action](https://github.com/aquasecurity/trivy-action), [Trivy configuration](https://github.com/aquasecurity/trivy/blob/main/docs/guide/configuration/others.md).

Run OS and library vulnerability scans in the blocking path. Report all unfixable critical and high findings. Each exception needs an owner, reason, and expiry date. Run misconfiguration, secret, and license scans in a report path first. Do not hide unfixed findings.

### Compose dependencies

`docker-compose.yml` uses `postgres:18` and `redis:8-alpine` tags. Pin both to tested manifest digests. Add a `docker-compose` entry to Dependabot. Docker and Docker Compose are separate Dependabot ecosystems. The current file has Docker entries for the two application Dockerfiles but no explicit Compose entry. Cite: [Dependabot supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories), [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

Pin the `node:24.18.1-bookworm` image used by the Ubuntu live test to a digest as well. Use the same update path as the application base images. A floating test image can change the test environment without a repository change.

## Supply-chain controls

### Dependency review

Add GitHub dependency review to pull requests. Block high and critical vulnerabilities across runtime, development, and unknown scopes. Report licenses without blocking until the repository defines a license policy. Dependency review can fail a pull request based on severity, license, and dependency scope. Cite: [GitHub dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review), [official dependency-review-action](https://github.com/actions/dependency-review-action).

The review checks repository manifest changes. Keep `bun install --frozen-lockfile` and the actual Vite+ checks as the authoritative build checks.

### CodeQL

Replace CodeQL default setup with an advanced workflow for JavaScript/TypeScript and GitHub Actions. Run it on pull requests, merge groups, pushes to `main`, and weekly. Use the `security-extended` query suite. Pin CodeQL actions to full SHAs. Cite: [CodeQL setup types](https://docs.github.com/en/code-security/concepts/code-scanning/setup-types), [CodeQL query suites](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-query-suites), [CodeQL workflow options](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options).

Resolve the current high incomplete-sanitization alert and medium improper-sanitization alert before enforcement. Code-scanning merge protection blocks high and critical alerts. Medium alerts remain visible for review.

### Scorecard and actionlint

Run Scorecard weekly and publish its report through code scanning. Its checks cover pinned dependencies, token permissions, and dangerous workflow patterns. The official action uses `security-events: write` and OIDC only when it publishes results. Cite: [OpenSSF Scorecard](https://github.com/ossf/scorecard), [Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md), [Scorecard action](https://github.com/ossf/scorecard-action).

Run blocking actionlint on every pull request that changes `.github/`. It catches workflow syntax, expressions, action inputs and outputs, runner labels, permission mistakes, shell errors, and several injection patterns. Cite: [actionlint repository](https://github.com/rhysd/actionlint), [actionlint checks](https://github.com/rhysd/actionlint/blob/main/docs/checks.md).

Enable private vulnerability reporting, secret validity checks, and non-provider secret patterns. Keep secret scanning and push protection active. Remove the permanent owner bypass from the `main` ruleset. An emergency needs an audited temporary ruleset change.

### Dependency submission

Evaluate dependency submission for the Bun workspace if GitHub's manifest graph misses resolved packages. GitHub accepts build-resolved dependency data through the dependency submission API. Do not add a custom submitter until a real graph gap exists. Cite: [GitHub dependency submission API](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/use-dependency-submission-api).

## Runner choices and workflow cost

The workflow uses `ubuntu-latest` and `macos-latest`. GitHub documents that `-latest` labels can move to a new runner image. Use `ubuntu-24.04`, `ubuntu-24.04-arm`, and `macos-15`. This makes a runner-image update a visible change. Cite: [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Do not use a self-hosted runner for untrusted pull-request code. A runner with a Docker socket or broad host access expands the impact of a malicious build. Docker's rootless mode reduces daemon privilege, but it does not make an arbitrary self-hosted runner safe for hostile code. Cite: [Docker engine security](https://docs.docker.com/engine/security/), [Docker rootless mode](https://docs.docker.com/engine/security/rootless/), [GitHub secure use](https://docs.github.com/en/actions/how-tos/secure-your-work).

Remove QEMU from the primary release path. Build and smoke amd64 on `ubuntu-24.04`. Build and smoke arm64 on `ubuntu-24.04-arm`. Keep all Storefront and Medusa checks on GitHub-hosted runners.

## Test partitioning and gates

Use conservative change-aware execution. A changed-scope decision saves time only when the gate still reports every applicable check. The first version can use path ownership that matches the repository boundaries:

| Change                                                                       | Required checks                                                                                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/storefront/**`, shared packages, root manifests, Vite+ config          | `checks`, live tooling, Docker integration, Storefront image validation                                     |
| `apps/medusa/**`, shared packages, root manifests, Vite+ config              | `checks`, live tooling, Docker integration, Medusa image validation                                         |
| `docker-compose.yml`, either Dockerfile, `.dockerignore`, container workflow | Docker build checks, Docker integration, both image validations                                             |
| `.github/**`, `mise.toml`, `package.json`, lockfile, `vite.config.ts`        | `checks`, actionlint, dependency review, CodeQL workflow analysis, Docker validation                        |
| docs-only change                                                             | Documentation checks and the always-running gate. Skip expensive execution with an explicit neutral result. |

Keep `bun run check` and `bun run test` together until Vite+ task timings show a useful split. A split that duplicates `bun install` or causes two cold Vite+ graphs is slower and less reliable. Use the Vite+ graph for ordering and caching.

Apply the accepted P95 targets from the decision summary. Track:

- queue time and runner time per job.
- P50 and P95 time to `ci-gate`.
- cache hit and miss rate.
- install time with and without the Bun cache.
- retry and flaky-test rate.
- Docker build time per image and platform.
- publication time from source revision to verified digest.

GitHub provides workflow usage, runner, queue, duration, and failure metrics. Write the key values into `$GITHUB_STEP_SUMMARY` so a run carries its own evidence. Cite: [GitHub Actions metrics](https://docs.github.com/en/actions/concepts/metrics), [workflow summaries](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions).

Do not add blind retries. Retry only transient network operations with a bounded count. A test retry must preserve the first failure and report it as flakiness.

## Artifacts and observability

Keep the current Oxlint summary and image metrics artifact. Add these fields:

- source commit and workflow run.
- runner label, OS, and architecture.
- Node, Bun, Docker, Buildx, and scanner versions.
- cache key, imported cache sources, and hit/miss result.
- image digest, image index digest, platform list, compressed size, and uncompressed size.
- SBOM and provenance presence.
- attestation verification result.
- Trivy database date and finding counts.
- elapsed time for install, Vite+ checks, image build, scan, and promotion.

Use unique artifact names for matrix jobs. GitHub artifact v4 artifacts are immutable, and matrix jobs must use distinct artifact names. Set `if-no-files-found: error` for files that a successful job must create. Keep release metrics, scan JSON, SBOM references, and image measurements for 90 days. Keep transient browser traces for 14 days after a real browser suite exists. Cite: [upload-artifact](https://github.com/actions/upload-artifact), [workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts).

The image job already writes a size summary and stores metrics. Extend that summary instead of creating a separate telemetry system. Keep the data long enough to measure P95 and image-size trends. A short retention window is fine for logs. Keep release evidence longer.

## Dependabot and update policy

The current Dependabot file covers Bun, Dockerfiles, and GitHub Actions. Keep the weekly groups because they limit pull-request volume. Add:

- `package-ecosystem: docker-compose` for `/docker-compose.yml`.
- a group for Compose service image updates.
- an explicit review path for action SHA updates.
- a scheduled check that the action pins still map to the release comments.

Dependabot supports Bun, Docker, Docker Compose, and GitHub Actions as separate ecosystems. Cite: [Dependabot supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories), [Dependabot configuration](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configuring-dependabot-version-updates).

Enable automatic merge after all gates pass for stable patch updates and action or image digest updates. Keep runtime and framework cohorts under manual review.

Do not add a second formatter, linter, test runner, or hook manager. Keep all package updates compatible with the Node and Bun versions declared in `mise.toml` and `package.json`. Test Medusa with Node, not Bun, because ADR-0001 and the repository guide define Node as the runtime.

## Earthly assessment

Earthly's model is an Earthfile target graph. Targets can depend on other targets, run in parallel, use Docker isolation, and use layer or cache mounts. Its documentation describes remote shared cache and remote runners. Cite: [Earthly documentation](https://docs.earthly.dev/), [Earthfile reference](https://docs.earthly.dev/docs/earthfile), [Earthly caching](https://docs.earthly.dev/docs/caching/caching-in-earthfiles), [Earthly remote runners](https://docs.earthly.dev/docs/remote-runners).

Yes, Earthly remains free to run on your own compute. Its source and CLI use the MPL-2.0 license. Earthly Cloud and its free Satellites ended on 2025-07-16. Free local use does not solve the maintenance and service-continuity risks. Cite: [Earthly license](https://github.com/earthly/earthly/blob/main/LICENSE), [Earthly shutdown announcement](https://earthly.dev/blog/shutting-down-earthfiles-cloud).

Those features overlap with two systems already present:

| Concern                    | Current repository owner              | Earthly overlap                                                                                      |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Application task graph     | Vite+                                 | Earthfile targets add a second graph.                                                                |
| Application runtime choice | Node runtime and Bun package manager  | Earthly adds a build language but does not replace the runtime decision.                             |
| Container build and cache  | Dockerfile + BuildKit/Buildx          | Earthly wraps BuildKit and adds another cache and target model.                                      |
| Multi-platform image       | Buildx Bake and native GitHub runners | Earthly selects platforms and remote builders. It does not remove the Dockerfile or registry policy. |
| CI orchestration           | GitHub Actions                        | Earthly adds an Earthfile, CLI setup, and possibly Earthly Cloud or a remote BuildKit service.       |

The official Earthly repository now says that the project is no longer actively maintained. Earthly Cloud ended on 2025-07-16. The announcement says the open-source project is limited to critical fixes. This status removes the maintenance and service continuity needed for a new core CI dependency. Cite: [Earthly repository status](https://github.com/earthly/earthly), [official shutdown announcement](https://earthly.dev/blog/shutting-down-earthfiles-cloud).

Reject these uses:

- replacing Vite+ with Earthly for `check`, `test`, or workspace builds.
- wrapping every GitHub job in Earthly.
- adding Earthly only to get a shared cache that BuildKit registry cache already supplies.
- placing secrets or release credentials in a new Earthly target without a long-term maintainer.
- depending on Earthly Cloud or a new remote BuildKit service for the release path.

## Staged implementation plan

### Stack 1: merge correctness and trust boundary

1. Add `merge_group` and an always-running `ci-gate`.
2. Define the required-check list and stable names in branch protection.
3. Split pull-request image validation from trusted image publication.
4. Remove write permissions from pull-request jobs.
5. Remove the `github.run_id` component from the Vite+ cache key.
6. Add actionlint and make workflow lint a required check.
7. Remove the no-op `browser` job.
8. Pin the Compose service images and the live-test Node image to digests.
9. Run Docker Build checks on both Dockerfiles.

### Stack 2: native container builds

1. Add `docker-bake.hcl` with Medusa and Storefront targets.
2. Build amd64 and arm64 on native GitHub runners.
3. Scan and smoke the exact platform digests.
4. Assemble the release image index from those digests.
5. Enforce the accepted compressed and uncompressed image budgets.
6. Add accepted BuildKit cache scopes and trust direction.

### Stack 3: release evidence and signatures

1. Push release images by digest and promote only the verified index digest.
2. Add BuildKit SPDX and provenance attestations.
3. Add GitHub artifact attestations and verification.
4. Add keyless Cosign signing and verification.
5. Upload Trivy SARIF and JSON with the accepted vulnerability policy.
6. Add `SOURCE_DATE_EPOCH` and the accepted reproducibility audits.
7. Keep release evidence for 90 days.

### Stack 4: repository policy and automation

1. Enable Merge Queue and update the `main` ruleset.
2. Remove the permanent owner bypass.
3. Enforce action SHA pins and the reviewed allowlist.
4. Add advanced CodeQL, dependency review, and scheduled Scorecard analysis.
5. Enable the accepted secret and vulnerability-reporting settings.
6. Add the accepted Dependabot automatic-merge policy.
7. Add P95, cache, image, scan, and signature evidence to workflow summaries.

Do not adopt Earthly or add another application task graph.

## Acceptance criteria

The modernization is complete when:

- a pull request and a merge-queue group both report one stable `ci-gate`.
- every applicable check blocks that gate.
- untrusted pull requests cannot push, publish attestations, or use release credentials.
- application checks still run through Vite+.
- both published image platforms have a verified manifest and a digest record.
- both platform digests were built and smoked on their native architecture.
- the promoted tag points to the scanned and attested digest.
- the image has BuildKit SBOM and provenance evidence.
- the image index has a verified GitHub artifact attestation and keyless Cosign signature.
- Cosign verification matches `release.yml`, `refs/heads/main`, and the GitHub Actions OIDC issuer.
- Trivy policy and SARIF evidence are visible in the run.
- Storefront and Medusa stay within their accepted image budgets.
- Dockerfile, Compose, action, dependency, and CodeQL checks run on their intended change scopes.
- the workflow summary reports cache state, versions, durations, image digests, sizes, and findings.
- the measured P95 required-check time and image-release time meet the repository's agreed targets.
- no Earthly dependency or second application task runner exists.

## Primary sources

The report uses primary documentation and source repositories only:

- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub Actions security hardening](https://docs.github.com/en/actions/how-tos/secure-your-work)
- [GitHub workflow syntax and permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub events and merge groups](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [GitHub merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue?apiVersion=2022-11-28)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub cache guidance](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)
- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [GitHub dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
- [GitHub CodeQL setup](https://docs.github.com/en/code-security/how-tos/scan-code-for-vulnerabilities/configure-code-scanning/configuring-default-setup-for-code-scanning)
- [GitHub runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- [Docker BuildKit cache backends](https://docs.docker.com/build/cache/backends/)
- [Docker GitHub Actions](https://docs.docker.com/build/ci/github-actions/)
- [Docker Buildx Bake](https://docs.docker.com/build/bake/)
- [Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/)
- [Docker build attestations](https://docs.docker.com/build/metadata/attestations/)
- [Docker reproducible builds](https://docs.docker.com/build/ci/github-actions/reproducible-builds/)
- [Docker build checks](https://docs.docker.com/reference/build-checks/)
- [Trivy action](https://github.com/aquasecurity/trivy-action)
- [actionlint](https://github.com/rhysd/actionlint)
- [OpenSSF Scorecard](https://github.com/ossf/scorecard)
- [Cosign](https://github.com/sigstore/cosign)
- [Sigstore keyless signing](https://docs.sigstore.dev/cosign/signing/overview/)
- [Cosign verification](https://docs.sigstore.dev/cosign/verifying/verify/)
- [GitHub OIDC](https://docs.github.com/en/actions/reference/security/oidc)
- [Minisign](https://github.com/jedisct1/minisign)
- [Earthly repository](https://github.com/earthly/earthly)
- [Earthly license](https://github.com/earthly/earthly/blob/main/LICENSE)
- [Earthly shutdown announcement](https://earthly.dev/blog/shutting-down-earthfiles-cloud)
