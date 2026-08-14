#!/usr/bin/env bash

set -euo pipefail

bake_plan="${1:?Pass the rendered Bake plan as the first argument}"
target="${2:?Pass the release target as the second argument}"

test -s "$bake_plan"
jq empty "$bake_plan"

if ! jq --exit-status --arg target "$target" '
  .target[$target] as $configuration
  | ($configuration | type == "object") and
    ($configuration.args | type == "object") and
    (($configuration.args | keys) == ["SOURCE_DATE_EPOCH"]) and
    ($configuration.args.SOURCE_DATE_EPOCH | test("^[0-9]+$")) and
    any($configuration.attest[]?; .type == "provenance" and .mode == "max") and
    any($configuration.attest[]?; .type == "sbom") and
    (
      [
        $configuration
        | ..
        | strings
        | select(test(
            "github_pat_|gh[pousr]_[0-9a-z]|[sr]k_(live|test|prod)_|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+PRIVATE KEY-----|xox[baprs]-|npm_[0-9a-z]";
            "i"
          ))
      ]
      | length == 0
    )
' "$bake_plan" >/dev/null; then
  echo "The rendered release target contains unsafe provenance inputs." >&2
  exit 1
fi
