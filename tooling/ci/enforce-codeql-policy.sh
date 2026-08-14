#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <report-path> <sarif-path>..." >&2
  exit 2
fi

report_path="$1"
shift

for sarif_path in "$@"; do
  if [[ ! -s "$sarif_path" ]]; then
    echo "CodeQL SARIF is missing or empty: $sarif_path" >&2
    exit 1
  fi

  jq --exit-status '
    type == "object" and
    (.runs | type == "array" and length > 0) and
    all(.runs[];
      . as $run |
      ($run.tool.driver | type == "object") and
      ($run.tool.driver.name | type == "string" and length > 0) and
      ($run.tool.driver.rules | type == "array") and
      ($run.results | type == "array") and
      all($run.results[];
        . as $result |
        ($result.ruleId | type == "string" and length > 0) and
        ($result.message.text | type == "string" and length > 0) and
        ([
          $run.tool.driver.rules[] |
          select(.id == $result.ruleId)
        ] | length == 1) and
        (([
            $run.tool.driver.rules[] |
            select(.id == $result.ruleId) |
            .properties["security-severity"]
          ] | first) as $rawSeverity |
          ($rawSeverity | type == "string") and
          (($rawSeverity | try tonumber catch null) as $severity |
            ($severity | type == "number") and
            ($severity >= 0) and
            ($severity <= 10)
          )
        )
      )
    )
  ' "$sarif_path" >/dev/null || {
    echo "CodeQL SARIF has an invalid structure: $sarif_path" >&2
    exit 1
  }
done

jq --slurp '
  [
    .[] |
    .runs[] |
    .tool.driver.rules as $rules |
    .results[] as $result |
    ($rules[] | select(.id == $result.ruleId)) as $rule |
    ($rule.properties["security-severity"] | tonumber) as $severity |
    {
      message: $result.message.text,
      ruleId: $result.ruleId,
      severity: $severity,
      severityLevel: (
        if $severity >= 9 then "critical"
        elif $severity >= 7 then "high"
        elif $severity >= 4 then "medium"
        elif $severity > 0 then "low"
        else "note"
        end
      )
    }
  ] as $findings |
  {
    blocking: ([$findings[] | select(.severity >= 7)] | length),
    critical: ([$findings[] | select(.severity >= 9)] | length),
    findings: $findings,
    high: ([$findings[] | select(.severity >= 7 and .severity < 9)] | length),
    low: ([$findings[] | select(.severity > 0 and .severity < 4)] | length),
    medium: ([$findings[] | select(.severity >= 4 and .severity < 7)] | length),
    note: ([$findings[] | select(.severity == 0)] | length)
  }
' "$@" >"$report_path"

blocking="$(jq --raw-output '.blocking' "$report_path")"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## CodeQL policy"
    echo
    echo "| Level | Findings |"
    echo "| --- | ---: |"
    echo "| Critical | $(jq --raw-output '.critical' "$report_path") |"
    echo "| High | $(jq --raw-output '.high' "$report_path") |"
    echo "| Medium | $(jq --raw-output '.medium' "$report_path") |"
    echo "| Low | $(jq --raw-output '.low' "$report_path") |"
    echo "| Note | $(jq --raw-output '.note' "$report_path") |"
    echo
    echo "High and critical findings block the job. Medium findings stay visible."
  } >>"$GITHUB_STEP_SUMMARY"
fi

if ((blocking > 0)); then
  jq --raw-output '
    .findings[] |
    select(.severity >= 7) |
    "\(.severityLevel): \(.ruleId): \(.message)"
  ' "$report_path" >&2
  exit 1
fi
