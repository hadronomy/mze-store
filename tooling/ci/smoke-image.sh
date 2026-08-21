#!/usr/bin/env bash

set -euo pipefail

image_ref="${1:?Pass an image reference as the first argument}"
image_name="${2:?Pass medusa or storefront as the second argument}"
container_name="mze-image-${image_name}-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}"

cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_url() {
  local url="$1"

  for _ in {1..60}; do
    if curl --fail --location --silent --show-error "$url" >/dev/null; then
      return 0
    fi
    sleep 2
  done

  docker logs "$container_name"
  return 1
}

docker image inspect "$image_ref" >/dev/null
test "$(docker image inspect --format '{{.Config.User}}' "$image_ref")" = "node"

case "$image_name" in
  medusa)
    medusa_environment=(
      --env "DB_HOST=127.0.0.1"
      --env "DB_PORT=5432"
      --env "DB_USERNAME=postgres"
      --env "DB_PASSWORD=password"
      --env "REDIS_HOST=127.0.0.1"
      --env "REDIS_PORT=6379"
      --env "STORE_CORS=http://127.0.0.1:3001"
      --env "ADMIN_CORS=http://127.0.0.1:9000"
      --env "AUTH_CORS=http://127.0.0.1:3001,http://127.0.0.1:9000"
      --env "JWT_SECRET=ci-medusa-jwt-secret-32-characters"
      --env "COOKIE_SECRET=ci-medusa-cookie-secret-32-characters"
      --env "ODOO_API_KEY=ci-placeholder-api-key"
      --env "STRIPE_API_KEY=sk_test_ci"
    )

    docker run --rm --network host "${medusa_environment[@]}" \
  "$image_ref" /app/node_modules/.bin/medusa db:migrate
    docker run --detach --name "$container_name" --network host \
      "${medusa_environment[@]}" "$image_ref" >/dev/null
    wait_for_url "http://127.0.0.1:9000/health"
    wait_for_url "http://127.0.0.1:9000/app"
    ;;
  storefront)
    docker run --detach --name "$container_name" --network host \
      --env "BETTER_AUTH_SECRET=ci-storefront-auth-secret-32-characters" \
      --env "BETTER_AUTH_URL=http://127.0.0.1:3001" \
      --env "CORS_ORIGIN=http://127.0.0.1:3001" \
      --env "DB_HOST=127.0.0.1" \
      --env "DB_PORT=5432" \
      --env "DB_USERNAME=postgres" \
      --env "DB_PASSWORD=password" \
      --env "REDIS_HOST=127.0.0.1" \
      --env "REDIS_PORT=6379" \
      "$image_ref" >/dev/null
    wait_for_url "http://127.0.0.1:3001/"
    ;;
  *)
    echo "Unknown image name: $image_name" >&2
    exit 64
    ;;
esac
