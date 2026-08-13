#!/usr/bin/env bash

set -euo pipefail

base_commit="${1:?Pass the base commit as the first argument}"
head_commit="${2:?Pass the head commit as the second argument}"
github_output="${3:?Pass the GitHub output file as the third argument}"
step_summary="${4:?Pass the step summary file as the fourth argument}"

validate_commit() {
  local commit="$1"

  if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]] || ! git cat-file -e "${commit}^{commit}"; then
    echo "Invalid comparison commit: ${commit}" >&2
    return 1
  fi
}

is_build_chain_path() {
  local path="$1"

  [[ "$path" =~ ^\.github/actions/.* ]] ||
    [[ "$path" =~ ^\.github/workflows/(ci|release|reproducibility)\.yml$ ]] ||
    [[ "$path" =~ ^apps/.*/Dockerfile$ ]] ||
    [[ "$path" =~ ^apps/[^/]+/package\.json$ ]] ||
    [[ "$path" =~ ^apps/[^/]+/medusa-config\.[^/]+$ ]] ||
    [[ "$path" =~ ^packages/[^/]+/package\.json$ ]] ||
    [[ "$path" =~ ^tooling/oxlint/package\.json$ ]] ||
    [[ "$path" =~ ^(apps|packages|tooling)/.*/tsconfig[^/]*\.json$ ]] ||
    [[ "$path" =~ ^(apps|packages|tooling)/.*/vite\.config\.[^/]+$ ]] ||
    [[ "$path" =~ ^tooling/ci/(compare-image-builds|detect-build-chain-changes)\.sh$ ]] ||
    [[ "$path" == "tooling/ci/normalize-storefront-output.mjs" ]] ||
    [[ "$path" =~ ^(\.dockerignore|bun\.lock|docker-bake\.hcl|mise\.toml|package\.json|tsconfig\.json|vite\.config\.ts)$ ]]
}

validate_commit "$base_commit"
validate_commit "$head_commit"

changed_paths="$(git diff --name-only --no-renames "$base_commit" "$head_commit")"
build_chain_path_count=0

while IFS= read -r changed_path; do
  if [[ -n "$changed_path" ]] && is_build_chain_path "$changed_path"; then
    build_chain_path_count=$((build_chain_path_count + 1))
  fi
done <<<"$changed_paths"

if ((build_chain_path_count > 0)); then
  echo "required=true" >>"$github_output"
  {
    echo "## Image reproducibility scope"
    echo "Result: required. ${build_chain_path_count} container build-chain path(s) changed."
  } >>"$step_summary"
else
  echo "required=false" >>"$github_output"
  {
    echo "## Image reproducibility scope"
    echo "Result: neutral. No container build-chain inputs changed."
  } >>"$step_summary"
fi
