#!/usr/bin/env bash

set -euo pipefail

image_ref="${1:?Pass an image reference as the first argument}"
image_name="${2:?Pass medusa or storefront as the second argument}"
platform="${3:?Pass the image platform as the third argument}"
output_file="${4:?Pass the JSON output path as the fourth argument}"
budget_file="tooling/ci/image-budgets.json"

compressed_budget="$(jq --exit-status --raw-output --arg image "$image_name" \
  '.[$image].compressedBytes | select(type == "number")' "$budget_file")"
uncompressed_budget="$(jq --exit-status --raw-output --arg image "$image_name" \
  '.[$image].uncompressedBytes | select(type == "number")' "$budget_file")"
uncompressed_bytes="$(docker image inspect --format '{{.Size}}' "$image_ref")"

if [[ "$image_ref" == *@sha256:* ]]; then
  manifest="$(docker buildx imagetools inspect "$image_ref" --raw)"
  manifest_ref="$image_ref"

  if jq --exit-status 'has("manifests")' <<<"$manifest" >/dev/null; then
    IFS=/ read -r platform_os platform_architecture platform_variant <<<"$platform"
    platform_digest="$(
      jq --exit-status --raw-output \
        --arg architecture "$platform_architecture" \
        --arg os "$platform_os" \
        --arg variant "${platform_variant:-}" \
        '[
          .manifests[]
          | select(
              .platform.os == $os and
              .platform.architecture == $architecture and
              ($variant == "" or .platform.variant == $variant)
            )
          | .digest
        ]
        | select(length == 1)
        | first
        | select(test("^sha256:[a-f0-9]{64}$"))' <<<"$manifest"
    )"
    manifest_ref="${image_ref%@*}@${platform_digest}"
    manifest="$(docker buildx imagetools inspect "$manifest_ref" --raw)"
  fi

  compressed_bytes="$(
    jq --exit-status --raw-output \
      '[.layers[].size] | add | select(type == "number" and . > 0)' <<<"$manifest"
  )"
else
  image_archive="$(mktemp)"
  trap 'rm -f "$image_archive"' EXIT
  docker save --output "$image_archive" "$image_ref"
  mapfile -t layers < <(tar -xOf "$image_archive" manifest.json | jq --exit-status --raw-output '.[0].Layers[]')
  test "${#layers[@]}" -gt 0

  compressed_bytes=0
  for layer in "${layers[@]}"; do
    layer_bytes="$(tar -xOf "$image_archive" "$layer" | gzip -n --stdout | wc -c | tr -d ' ')"
    compressed_bytes=$((compressed_bytes + layer_bytes))
  done
fi

[[ "$compressed_bytes" =~ ^[1-9][0-9]*$ ]]
[[ "$uncompressed_bytes" =~ ^[1-9][0-9]*$ ]]
mkdir -p "$(dirname "$output_file")"

jq --null-input \
  --arg image "$image_name" \
  --arg imageRef "$image_ref" \
  --arg platform "$platform" \
  --argjson compressedBytes "$compressed_bytes" \
  --argjson compressedBudget "$compressed_budget" \
  --argjson uncompressedBytes "$uncompressed_bytes" \
  --argjson uncompressedBudget "$uncompressed_budget" \
  '{
    image: $image,
    imageRef: $imageRef,
    platform: $platform,
    compressedBytes: $compressedBytes,
    compressedBudget: $compressedBudget,
    uncompressedBytes: $uncompressedBytes,
    uncompressedBudget: $uncompressedBudget,
    withinBudget: (
      $compressedBytes <= $compressedBudget and
      $uncompressedBytes <= $uncompressedBudget
    )
  }' >"$output_file"
