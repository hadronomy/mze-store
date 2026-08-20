# Aiden Bai React tooling for MZE Store

Checked 2026-08-20. This report uses official repositories, source files, documentation, and npm metadata.

## Decision

Use the three tools in `apps/storefront` only. The Storefront uses TanStack Start, Vite, React 19, and bundled ESM. Medusa is a separate CommonJS TypeScript island, so these browser tools do not belong there. Keep all three packages as Storefront development dependencies. Keep React Doctor advisory in pull requests.

| Tool         | Function                                                          | Storefront use                                                                              |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| React Grab   | Copies a selected UI element and its source context for an agent. | Load it from `src/routes/__root.tsx` in development. Install its agent skill at user scope. |
| React Scan   | Shows React renders and performance problems in the browser.      | Use the TanStack Start manual setup. Do not use its Vite plugin.                            |
| React Doctor | Runs static React checks and optional performance traces.         | Run a Storefront-only advisory GitHub Action and use its agent skill.                       |

The current package versions are `react-grab` 0.2.0, `react-scan` 0.5.7, and `react-doctor` 0.9.12. These are registry values checked on the date above. Use exact versions when implementation starts. Do not copy the tools' `@latest` examples into the committed manifest.

## Repository fit

The Storefront entry boundary is `apps/storefront/src/routes/__root.tsx`. React Grab's CLI detects `@tanstack/react-start`, and its source includes a TanStack transform for `src/routes/__root.tsx`. React Scan's TanStack guide also uses the root document. The Vite+ task graph remains the source for formatting, linting, type checks, and tests.

Sources: [Storefront architecture](../architecture.md), [React Grab framework detection](https://github.com/aidenybai/react-grab/blob/main/packages/cli/src/utils/detect.ts), [React Grab TanStack transform](https://github.com/aidenybai/react-grab/blob/main/packages/cli/src/utils/transform.ts), and [React Scan TanStack Start setup](https://github.com/aidenybai/react-scan/blob/main/docs/installation/tanstack-start.md).

## React Grab

React Grab provides source-aware UI context for coding agents. A browser selection copies the component stack, source location, and related context. The official quick start is `npx grab@latest init`; the CLI also supports Bun and detects TanStack Start. Its repository contains a TanStack Start end-to-end fixture.

Sources: [React Grab README](https://github.com/aidenybai/react-grab#readme), [package metadata](https://registry.npmjs.org/react-grab/latest), [CLI package metadata](https://registry.npmjs.org/grab/latest), and [TanStack Start fixture](https://github.com/aidenybai/react-grab/tree/main/apps/e2e-app-tanstack-start).

For this repository, use the CLI with Bun when implementation starts:

```sh
bunx grab@0.2.0 init -c apps/storefront --skip-install
```

The `--skip-install` flag lets the repository add the exact package version itself. The equivalent manual code in `RootDocument` is:

```tsx
useEffect(() => {
  if (import.meta.env.DEV) {
    void import("react-grab");
  }
}, []);
```

This import is development-only. It does not add React Grab to the production execution path. The CLI adds this effect and the `useEffect` import for a TanStack root route.

Install the official React Grab skill separately at user scope:

```sh
bunx grab@0.2.0 add --yes --global -c apps/storefront
```

The skill runs a local clipboard loop. The browser and the agent must run on the same machine. The official skill uses `react-grab pull --max-age 0` and `react-grab stop`; use `bunx` in this repository in place of the skill's documented `npx` spelling. Source: [React Grab skill](https://github.com/aidenybai/react-grab/blob/main/skills/react-grab/SKILL.md).

The runtime and extension privacy page says that React Grab does not collect, store, or transmit personal data. The CLI source sends version and setup diagnostics unless `DO_NOT_TRACK=1` or `DO_NOT_TRACK=true`. Set that variable in environments that require an opt-out. Sources: [privacy page](https://www.react-grab.com/privacy), [telemetry check](https://github.com/aidenybai/react-grab/blob/main/packages/cli/src/utils/is-telemetry-enabled.ts), and [CLI telemetry](https://github.com/aidenybai/react-grab/blob/main/packages/cli/src/commands/init.ts). React Grab is MIT licensed: [license](https://github.com/aidenybai/react-grab/blob/main/LICENSE).

## React Scan

React Scan instruments React at runtime and highlights components that render. It provides a toolbar and render information. Its official TanStack Start guide supports React 19 and gives two manual options: a script in `RootDocument`, or a module import before React and the TanStack renderer.

Sources: [React Scan README](https://github.com/aidenybai/react-scan#readme), [TanStack Start guide](https://github.com/aidenybai/react-scan/blob/main/docs/installation/tanstack-start.md), [Vite guide](https://github.com/aidenybai/react-scan/blob/main/docs/installation/vite.md), and [package metadata](https://registry.npmjs.org/react-scan/latest).

Use the module option in the Storefront. Import `scan` before React and all React renderers. Call it after hydration and enable it only in development:

```tsx
import { scan } from "react-scan";

useEffect(() => {
  if (import.meta.env.DEV) {
    scan({ enabled: true });
  }
}, []);
```

Place the import before other React imports in the client entry that owns the renderer. If the TanStack client entry makes that order impossible, use the official `RootDocument` script option and gate the script with the development build. Do not import `react-scan/all-environments`; that option enables production instrumentation.

Do not add `@react-scan/vite-plugin-react-scan`. Its published peer range ends at Vite 6, while this repository uses Vite 8 through Vite+. The Scan CLI detects TanStack Start but its source returns “manual setup” for that framework. The CLI therefore does not provide a safe automatic setup for this Storefront. Sources: [plugin package metadata](https://registry.npmjs.org/@react-scan%2Fvite-plugin-react-scan/latest) and [Scan CLI setup source](https://github.com/aidenybai/react-scan/blob/main/packages/scan/src/cli-utils.mts).

React Scan has no published telemetry policy in the reviewed official docs. Its source performs a best-effort React Grab version request when the browser is online. The optional `react-scan/lite` API sends events only when the caller supplies an endpoint and session ID. The normal Storefront setup does not supply either value. Sources: [version check source](https://github.com/aidenybai/react-scan/blob/main/packages/scan/src/web/utils/check-react-grab-version.ts) and [lite API source](https://github.com/aidenybai/react-scan/tree/main/packages/scan/src/lite).

React Scan is MIT licensed: [license](https://github.com/aidenybai/react-scan/blob/main/LICENSE).

One packaging detail matters. `react-scan` currently declares `react-grab: "latest"` and `react-doctor: "latest"` as dependencies. Add the three tools as direct exact Storefront development dependencies so the lockfile records the intended versions and the dependency purpose is clear.

## React Doctor

React Doctor is a static analyzer for React correctness, performance, security, accessibility, and maintainability. It supports Vite and TanStack. It complements the repository's private Oxlint package and does not replace the Vite+ check task.

Sources: [React Doctor documentation](https://www.react.doctor/docs), [quick start](https://www.react.doctor/docs/getting-started/quickstart), [CLI reference](https://www.react.doctor/docs/reference/cli-reference), and [package metadata](https://registry.npmjs.org/react-doctor/latest).

Use this local command from the Storefront when a developer wants changed-file findings:

```sh
cd apps/storefront
bunx react-doctor@0.9.12 --verbose --scope changed --no-telemetry
```

The official coding-agent skill runs the same changed-scope command after React edits. The Doctor `install` command is project-scoped. It can add a package, a package script, a workflow, hooks, and agent files. It has no user-level `--global` option. Do not run `react-doctor install --yes` in this repository when the goal is a user-level skill. Install the canonical skill file at the user's agent-skill location through the skill manager. Source: [official Doctor skill](https://github.com/millionco/react-doctor/blob/main/.agents/skills/react-doctor/SKILL.md) and [agent install source](https://github.com/millionco/react-doctor/blob/main/packages/react-doctor/src/cli/utils/install-react-doctor.ts).

Commit one advisory workflow for the Storefront. Use full history so changed-scope analysis can compare the merge base:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
  statuses: write

steps:
  - uses: actions/checkout@<the-repository-pinned-sha>
    with:
      fetch-depth: 0
  - uses: millionco/react-doctor@01820bb4fd4d0a4aebcd8df2b2a143a098649cb2 # v2.2.8, resolved 2026-08-20
    with:
      project: storefront
      scope: changed
      blocking: none
      version: 0.9.12
```

The official action defaults to advisory behavior. It posts a summary and inline findings when the workflow has the listed write permissions. Pin both actions to immutable SHAs because this repository requires pinned GitHub Actions. The Doctor documentation uses the mutable `millionco/react-doctor@v2` example; the SHA above is the commit resolved from that tag on the date of this report. Sources: [GitHub Actions setup](https://www.react.doctor/docs/ci-and-prs/github-actions-setup), [configuration reference](https://www.react.doctor/docs/configuration/config-files), and [v2 tag](https://github.com/millionco/react-doctor/releases/tag/v2.2.8).

The action can download pull request head and base archives to an isolated sandbox. The documented output includes paths, line numbers, rule messages, framework data, and aggregate scores. Review this data flow before enabling comments on private code. Local CLI telemetry includes crash data, command context, project shape, and rule counts. Use `--no-telemetry` locally. Sources: [Doctor privacy](https://www.react.doctor/docs/legal/privacy), [CI data use](https://www.react.doctor/docs/legal/data-use), and [telemetry reference](https://www.react.doctor/docs/reference/cli-reference).

React Doctor 0.9.12 depends on `oxlint >=1.77.0 <1.78.0` and TypeScript `<6`. MZE Store currently uses Oxlint 1.78.0 and TypeScript 6. Let Bun resolve Doctor's compatible nested dependencies. Do not change the repository's Oxlint or TypeScript versions to satisfy Doctor. Run the Storefront check after installation and inspect the lockfile.

React Doctor uses a modified MIT license. Normal local and CI use fit the license. The license requires written permission for AI or machine-learning training, automated data collection to improve AI, and certain paid hosted products. Source: [license terms](https://www.react.doctor/docs/legal/license) and [license file](https://github.com/millionco/react-doctor/blob/main/LICENSE).

## Skill plan

Install only the user-level skills below:

1. Install React Grab with `bunx grab@0.2.0 add --yes --global -c apps/storefront`.
2. Install the canonical React Doctor skill into the user's agent-skill directory through the skill manager. Do not use the project-scoped Doctor `install` command for this purpose.
3. Do not install a React Scan skill. The official Scan repository has no React Scan coding-agent skill. React Doctor covers the static review, and React Scan remains a browser runtime tool.

The React Grab skill watches the local clipboard. The Doctor skill reads project files and runs Doctor commands. Both skills need local access to the Storefront. Keep their package commands on exact versions after the package install.

## Implementation order

1. Add exact development dependencies to `apps/storefront`.
2. Add the React Grab development-only dynamic import to `RootDocument`.
3. Add the React Scan manual module setup, and confirm import order in the TanStack client build.
4. Add the pinned, Storefront-only, advisory Doctor workflow.
5. Install the two user-level skills.
6. Run `bun run check`, a Storefront development session, React Grab selection, React Scan rendering, and the Doctor changed-scope command.

## Applied implementation

The plan is applied in this worktree.

- `apps/storefront/package.json` now pins `react-grab` 0.2.0, `react-scan` 0.5.7, and `react-doctor` 0.9.12 as development dependencies. The package also has a `doctor` script for changed-scope, no-telemetry local checks.
- `apps/storefront/src/routes/__root.tsx` uses the TanStack Start module setup for React Scan and loads React Grab with a development-only dynamic import. React Scan starts after hydration.
- `apps/storefront/vite.config.ts` bundles React Scan and React Grab for SSR. React Scan reads React Grab package metadata; bundling avoids a Node JSON-module import error during the development SSR request.
- `.github/workflows/react-doctor.yml` scans the Storefront with full history, changed scope, pinned action revisions, exact Doctor version, comments, inline review comments, and `blocking: none`.
- The root `doctor` script delegates to the Storefront script. Vite+ remains the only repository task graph.

The official CLIs ran through the Bun version pinned by `mise.toml` because Bun was not on `PATH`:

```sh
mise --no-config exec bun@1.3.14 -- bun x grab@latest init --yes --global --cwd apps/storefront
mise --no-config exec bun@1.3.14 -- bun x grab@latest add --yes --global --cwd apps/storefront
mise --no-config exec bun@1.3.14 -- bun x react-doctor@latest install --cwd /Users/hadronomy
mise --no-config exec bun@1.3.14 -- bun x react-doctor@latest ci install \
  --provider github-actions --blocking none --scope changed \
  --comment --review-comments --commit-status --yes --cwd .
```

The Grab CLI added its TanStack root setup and the React Grab skill. The Doctor CLI installed the canonical React Doctor skill. Both skills are now available at the user-level agent and Claude skill directories under `/Users/hadronomy/.agents/skills` and `/Users/hadronomy/.claude/skills`. React Scan has no official coding-agent skill, so none was installed.

The initial Doctor run reported six existing Storefront findings in unused files, a static value rebuilt during render, and two `preventDefault` findings. CI remains advisory so this integration does not block a pull request on that existing baseline.

Verification completed:

- `bun install --frozen-lockfile` passed.
- `bun run check` passed.
- `bun run --cwd apps/storefront build` passed.
- A development SSR request returned HTTP 200 after the SSR bundling rule was added. The local server still reports the expected missing database and Redis environment values because this worktree has no `.env` files.
