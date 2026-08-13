#!/usr/bin/env bash

set -euo pipefail

image_name="${1:?Pass the image name as the first argument}"
platform="${2:?Pass the platform as the second argument}"
first_index="${3:?Pass the first OCI index as the third argument}"
first_manifest="${4:?Pass the first image manifest as the fourth argument}"
second_index="${5:?Pass the second OCI index as the fifth argument}"
second_manifest="${6:?Pass the second image manifest as the sixth argument}"
evidence_file="${7:?Pass the evidence output as the seventh argument}"

for input_file in "$first_index" "$first_manifest" "$second_index" "$second_manifest"; do
  test -s "$input_file"
  jq empty "$input_file"
done

first_index_digest="sha256:$(sha256sum "$first_index" | cut -d ' ' -f 1)"
first_manifest_digest="sha256:$(sha256sum "$first_manifest" | cut -d ' ' -f 1)"
second_index_digest="sha256:$(sha256sum "$second_index" | cut -d ' ' -f 1)"
second_manifest_digest="sha256:$(sha256sum "$second_manifest" | cut -d ' ' -f 1)"

jq --null-input \
  --arg image "$image_name" \
  --arg platform "$platform" \
  --arg firstIndexDigest "$first_index_digest" \
  --arg firstManifestDigest "$first_manifest_digest" \
  --arg secondIndexDigest "$second_index_digest" \
  --arg secondManifestDigest "$second_manifest_digest" \
  --slurpfile first "$first_manifest" \
  --slurpfile second "$second_manifest" '
  ($first[0].layers | map(.digest)) as $firstLayers
  | ($second[0].layers | map(.digest)) as $secondLayers
  | {
      image: $image,
      platform: $platform,
      firstIndexDigest: $firstIndexDigest,
      secondIndexDigest: $secondIndexDigest,
      firstManifestDigest: $firstManifestDigest,
      secondManifestDigest: $secondManifestDigest,
      firstLayers: $firstLayers,
      secondLayers: $secondLayers,
      matches: (
        ($firstIndexDigest == $secondIndexDigest) and
        ($firstManifestDigest == $secondManifestDigest) and
        ($firstLayers == $secondLayers)
      )
    }
' >"$evidence_file"

if ! jq --exit-status '.matches' "$evidence_file" >/dev/null; then
  jq . "$evidence_file" >&2
  exit 1
fi
