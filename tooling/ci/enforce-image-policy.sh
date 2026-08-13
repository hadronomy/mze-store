#!/usr/bin/env bash

set -euo pipefail

image_name="${1:?Pass medusa or storefront as the first argument}"
platform="${2:?Pass the image platform as the second argument}"
scan_file="${3:?Pass the Trivy JSON path as the third argument}"
size_file="${4:?Pass the size JSON path as the fourth argument}"
exceptions_file="${5:?Pass the exception JSON path as the fifth argument}"
version_file="${6:?Pass the Trivy version JSON path as the sixth argument}"
policy_file="${7:?Pass the policy JSON output path as the seventh argument}"
today="${POLICY_TODAY:-$(date -u +%F)}"

for evidence_file in "$scan_file" "$size_file" "$exceptions_file" "$version_file"; do
  test -s "$evidence_file"
  jq empty "$evidence_file"
done

jq --exit-status --arg today "$today" '
  def nonempty: type == "string" and length > 0;
  type == "array" and all(.[];
    ((.image == "medusa") or (.image == "storefront")) and
    (.id | nonempty) and
    (.package | nonempty) and
    (.owner | nonempty) and
    (.reason | nonempty) and
    (.expires | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")) and
    (.expires > $today)
  )
' "$exceptions_file" >/dev/null

jq --exit-status '.Results | type == "array"' "$scan_file" >/dev/null
jq --exit-status '
  (.withinBudget | type == "boolean") and
  (.compressedBytes | type == "number" and . > 0) and
  (.uncompressedBytes | type == "number" and . > 0)
' "$size_file" >/dev/null

jq --null-input \
  --arg image "$image_name" \
  --arg platform "$platform" \
  --slurpfile scan "$scan_file" \
  --slurpfile size "$size_file" \
  --slurpfile exceptions "$exceptions_file" '
  [
    $scan[0].Results[] as $result
    | ($result.Vulnerabilities // [])[]
    | select((.Severity == "HIGH") or (.Severity == "CRITICAL"))
    | . as $finding
    | (($finding.FixedVersion // "") | length > 0) as $fixable
    | any($exceptions[0][];
        (.image == $image) and
        (.id == $finding.VulnerabilityID) and
        (.package == $finding.PkgName)
      ) as $excepted
    | {
        id: $finding.VulnerabilityID,
        package: $finding.PkgName,
        installedVersion: $finding.InstalledVersion,
        fixedVersion: ($finding.FixedVersion // ""),
        severity: $finding.Severity,
        target: $result.Target,
        fixable: $fixable,
        excepted: $excepted,
        blocking: (
          $fixable and (
            ($finding.Severity == "CRITICAL") or
            (($finding.Severity == "HIGH") and ($excepted | not))
          )
        )
      }
  ] as $findings
  | {
      image: $image,
      platform: $platform,
      withinBudget: $size[0].withinBudget,
      totalCount: ($findings | length),
      fixableCount: ($findings | map(select(.fixable)) | length),
      unfixableCount: ($findings | map(select(.fixable | not)) | length),
      blockingCount: ($findings | map(select(.blocking)) | length),
      findings: $findings
    }
' >"$policy_file"

compressed_bytes="$(jq --raw-output '.compressedBytes' "$size_file")"
compressed_budget="$(jq --raw-output '.compressedBudget' "$size_file")"
uncompressed_bytes="$(jq --raw-output '.uncompressedBytes' "$size_file")"
uncompressed_budget="$(jq --raw-output '.uncompressedBudget' "$size_file")"
total_count="$(jq --raw-output '.totalCount' "$policy_file")"
fixable_count="$(jq --raw-output '.fixableCount' "$policy_file")"
unfixable_count="$(jq --raw-output '.unfixableCount' "$policy_file")"
blocking_count="$(jq --raw-output '.blockingCount' "$policy_file")"
within_budget="$(jq --raw-output '.withinBudget' "$policy_file")"
scanner_version="$(jq --raw-output '.Version // "unknown"' "$version_file")"
database_date="$(jq --raw-output '.VulnerabilityDB.UpdatedAt // "unknown"' "$version_file")"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"

{
  echo "## Image policy: ${image_name} (${platform})"
  echo
  echo "- Trivy version: ${scanner_version}"
  echo "- Vulnerability database: ${database_date}"
  echo "- High and critical findings: ${total_count} (${fixable_count} fixable, ${unfixable_count} unfixable)"
  echo "- Blocking findings: ${blocking_count}"
  echo "- Compressed bytes: ${compressed_bytes} / ${compressed_budget}"
  echo "- Uncompressed bytes: ${uncompressed_bytes} / ${uncompressed_budget}"
} >>"$summary_file"

test "$within_budget" = "true"
test "$blocking_count" -eq 0
