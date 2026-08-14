#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <dependency-changes-json> <summary-path>" >&2
  exit 2
fi

changes_path="$1"
summary_path="$2"

jq --exit-status '
  type == "array" and
  all(.[];
    type == "object" and
    (.name | type == "string") and
    (.version | type == "string") and
    ((.scope // "unknown") | IN("runtime", "development", "unknown")) and
    ((.license == null) or (.license | type == "string"))
  )
' "$changes_path" >/dev/null || {
  echo "Dependency review returned invalid or missing analysis." >&2
  exit 1
}

change_count="$(jq --raw-output 'length' "$changes_path")"

if ((change_count == 0)); then
  {
    echo "## Dependency review"
    echo
    echo "Result: neutral. This change introduces no dependency changes."
  } >>"$summary_path"
  exit 0
fi

{
  echo "## Dependency licenses"
  echo
  echo "License findings are report-only. Vulnerability policy remains blocking."
  echo
  echo "| Dependency | Version | Scope | License |"
  echo "| --- | --- | --- | --- |"

  jq --raw-output '
    def markdown:
      tostring |
      gsub("[\\r\\n]"; " ") |
      gsub("\\|"; "\\|");

    .[] |
    "| \(.name | markdown) | \(.version | markdown) | \((.scope // "unknown") | markdown) | \((.license // "unknown") | markdown) |"
  ' "$changes_path"
} >>"$summary_path"
