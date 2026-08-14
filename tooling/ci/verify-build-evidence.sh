#!/usr/bin/env bash

set -euo pipefail

provenance_file="${1:?Pass the BuildKit provenance JSON as the first argument}"
sbom_file="${2:?Pass the BuildKit SBOM JSON as the second argument}"

for evidence_file in "$provenance_file" "$sbom_file"; do
  test -s "$evidence_file"
  jq empty "$evidence_file"
done

jq --exit-status '
  . as $evidence
  | ["linux/amd64", "linux/arm64"]
  | all(
      . as $platform
      | [
          $evidence[$platform]
          | ..
          | objects
          | select(
              (.buildType? | type == "string") and
              (.buildType | contains("buildkit"))
            )
        ]
        | length > 0
    )
' "$provenance_file" >/dev/null

jq --exit-status '
  . as $evidence
  | ["linux/amd64", "linux/arm64"]
  | all(
      . as $platform
      | [$evidence[$platform] | .. | objects | select(.SPDXID? == "SPDXRef-DOCUMENT")]
        | length > 0
    )
' "$sbom_file" >/dev/null

if jq --exit-status '
  [
    ..
    | strings
    | select(test(
        "github_pat_|gh[pousr]_|sk_(live|test)_|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+PRIVATE KEY-----";
        "i"
      ))
  ]
  | length > 0
' "$provenance_file" >/dev/null; then
  echo "Build provenance contains a value that looks sensitive." >&2
  exit 1
fi
