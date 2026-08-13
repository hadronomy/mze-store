#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <metrics-path> <summary-path>" >&2
  exit 2
fi

metrics_path="$1"
summary_path="$2"

jq --null-input \
  --arg bunCacheHit "${BUN_CACHE_HIT:-false}" \
  --arg bunCacheKey "${BUN_CACHE_KEY:-unavailable}" \
  --arg checkSeconds "${CHECK_SECONDS:-}" \
  --arg commit "${GITHUB_SHA:-unknown}" \
  --arg event "${GITHUB_EVENT_NAME:-unknown}" \
  --arg installSeconds "${INSTALL_SECONDS:-}" \
  --arg runAttempt "${GITHUB_RUN_ATTEMPT:-unknown}" \
  --arg runId "${GITHUB_RUN_ID:-unknown}" \
  --arg runnerArch "${RUNNER_ARCH:-unknown}" \
  --arg runnerOs "${RUNNER_OS:-unknown}" \
  --arg viteCacheHit "${VITE_CACHE_HIT:-false}" \
  --arg viteCacheKey "${VITE_CACHE_KEY:-unavailable}" '
  def numberOrNull: if test("^[0-9]+$") then tonumber else null end;
  {
    bun: {
      cacheHit: ($bunCacheHit == "true"),
      cacheKey: $bunCacheKey,
      importedScopes: ["current-ref", "default-branch"]
    },
    checkSeconds: ($checkSeconds | numberOrNull),
    commit: $commit,
    event: $event,
    installSeconds: ($installSeconds | numberOrNull),
    runAttempt: $runAttempt,
    runId: $runId,
    runner: { architecture: $runnerArch, os: $runnerOs },
    vite: {
      cacheHit: ($viteCacheHit == "true"),
      cacheKey: $viteCacheKey,
      importedScopes: [
        "exact-change-scope",
        "matching-input-scope",
        "matching-runtime-scope",
        "default-branch"
      ]
    }
  }
' >"$metrics_path"

{
  echo "## Application checks"
  echo "Bun cache key: ${BUN_CACHE_KEY:-unavailable}"
  echo "Bun imported scopes: current ref, then default branch"
  echo "Bun cache result: ${BUN_CACHE_HIT:-false}"
  echo "Vite+ cache key: ${VITE_CACHE_KEY:-unavailable}"
  echo "Vite+ imported scopes: exact change, matching inputs, matching runtime, then default branch"
  echo "Vite+ cache result: ${VITE_CACHE_HIT:-false}"
  echo "Install seconds: ${INSTALL_SECONDS:-unknown}"
  echo "Check seconds: ${CHECK_SECONDS:-unknown}"
} >>"$summary_path"
