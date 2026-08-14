#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <scorecard-sarif> <owner/repository> <summary-path>" >&2
  exit 2
fi

sarif_path="$1"
repository="$2"
summary_path="$3"

if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "Invalid repository name: $repository" >&2
  exit 1
fi

jq --exit-status '
  type == "object" and
  (.runs | type == "array" and length > 0) and
  all(.runs[];
    . as $run |
    ($run.tool.driver.name == "Scorecard") and
    ($run.tool.driver.rules | type == "array") and
    ($run.results | type == "array") and
    all($run.results[];
      . as $result |
      ($result.ruleId | type == "string") and
      ($result.message.text | type == "string") and
      any($run.tool.driver.rules[];
        (.id == $result.ruleId) and
        (.helpUri | type == "string" and startswith("https://"))
      )
    )
  )
' "$sarif_path" >/dev/null || {
  echo "Scorecard returned invalid or incomplete SARIF evidence." >&2
  exit 1
}

finding_count="$(jq --raw-output '[.runs[].results[]] | length' "$sarif_path")"

if ((finding_count == 0)); then
  {
    echo "## OpenSSF Scorecard"
    echo
    echo "No Scorecard findings were reported."
  } >>"$summary_path"
  exit 0
fi

{
  echo "## OpenSSF Scorecard evidence"
  echo
  echo "| Check | Severity | Evidence | Result |"
  echo "| --- | --- | --- | --- |"

  jq --raw-output --arg repository "$repository" '
    def markdown:
      tostring |
      gsub("[\\r\\n]"; " ") |
      gsub("\\|"; "\\|");

    .runs[] as $run |
    $run.results[] as $result |
    ($run.tool.driver.rules[] | select(.id == $result.ruleId)) as $rule |
    (
      ($rule.name? | select(type == "string" and length > 0)) //
      ($rule.shortDescription.text? | select(type == "string" and length > 0)) //
      $rule.id
    ) as $check_name |
    (
      "https://github.com/\($repository)/security/code-scanning" +
      "?query=tool%3AScorecard+rule%3A\($result.ruleId | @uri)"
    ) as $evidence |
    "| [\($check_name | markdown)](\($rule.helpUri)) | " +
    "\(($rule.properties["security-severity"] // "unknown") | markdown) | " +
    "[Open evidence](\($evidence)) | " +
    "\(($result.message.text | split("\\n")[0]) | markdown) |"
  ' "$sarif_path"
} >>"$summary_path"
