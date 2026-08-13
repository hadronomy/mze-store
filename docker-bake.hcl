variable "REGISTRY" {
  default = "ghcr.io/hadronomy"
}

variable "REVISION" {
  default = "local"
}

variable "CREATED" {
  default = "1970-01-01T00:00:00Z"
}

variable "CACHE_SCOPE" {
  default = "local"
}

variable "SOURCE_URL" {
  default = "https://github.com/hadronomy/mze-store"
}

group "default" {
  targets = ["medusa", "storefront"]
}

group "ci" {
  targets = ["medusa-ci", "storefront-ci"]
}

group "release" {
  targets = ["medusa-release", "storefront-release"]
}

target "_common" {
  context = "."
  labels = {
    "org.opencontainers.image.created"  = CREATED
    "org.opencontainers.image.revision" = REVISION
    "org.opencontainers.image.source"   = SOURCE_URL
    "org.opencontainers.image.version"  = REVISION
  }
}

target "medusa" {
  inherits   = ["_common"]
  dockerfile = "apps/medusa/Dockerfile"
  tags       = ["mze-store-medusa:local"]
}

target "storefront" {
  inherits   = ["_common"]
  dockerfile = "apps/storefront/Dockerfile"
  tags       = ["mze-store-storefront:local"]
}

target "medusa-ci" {
  inherits   = ["medusa"]
  tags       = ["mze-store-medusa:pr"]
  platforms  = ["linux/amd64"]
  cache-from = [
    "type=gha,scope=mze-store-medusa-pr-${CACHE_SCOPE}",
    "type=gha,scope=mze-store-medusa-main",
  ]
  cache-to = ["type=gha,mode=min,scope=mze-store-medusa-pr-${CACHE_SCOPE}"]
  output     = ["type=docker"]
}

target "storefront-ci" {
  inherits   = ["storefront"]
  tags       = ["mze-store-storefront:pr"]
  platforms  = ["linux/amd64"]
  cache-from = [
    "type=gha,scope=mze-store-storefront-pr-${CACHE_SCOPE}",
    "type=gha,scope=mze-store-storefront-main",
  ]
  cache-to = ["type=gha,mode=min,scope=mze-store-storefront-pr-${CACHE_SCOPE}"]
  output     = ["type=docker"]
}

target "medusa-release" {
  inherits   = ["medusa"]
  tags       = ["${REGISTRY}/mze-store-medusa:${REVISION}"]
  platforms  = ["linux/amd64", "linux/arm64"]
  cache-from = [
    "type=registry,ref=${REGISTRY}/mze-store-medusa:buildcache",
    "type=gha,scope=mze-store-medusa-main",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/mze-store-medusa:buildcache,mode=max",
    "type=gha,mode=max,scope=mze-store-medusa-main",
  ]
  output = ["type=registry"]
  attest     = ["type=provenance,mode=max", "type=sbom"]
}

target "storefront-release" {
  inherits   = ["storefront"]
  tags       = ["${REGISTRY}/mze-store-storefront:${REVISION}"]
  platforms  = ["linux/amd64", "linux/arm64"]
  cache-from = [
    "type=registry,ref=${REGISTRY}/mze-store-storefront:buildcache",
    "type=gha,scope=mze-store-storefront-main",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/mze-store-storefront:buildcache,mode=max",
    "type=gha,mode=max,scope=mze-store-storefront-main",
  ]
  output = ["type=registry"]
  attest     = ["type=provenance,mode=max", "type=sbom"]
}
