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

variable "CACHE_ARCH" {
  default = "amd64"
}

variable "SOURCE_URL" {
  default = "https://github.com/hadronomy/mze-store"
}

variable "PLATFORM" {
  default = "linux/amd64"
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
  platforms  = [PLATFORM]
  cache-from = [
    "type=gha,scope=mze-store-medusa-pr-${CACHE_SCOPE}-${CACHE_ARCH}",
    "type=gha,scope=mze-store-medusa-main-${CACHE_ARCH}",
  ]
  cache-to   = ["type=gha,mode=min,scope=mze-store-medusa-pr-${CACHE_SCOPE}-${CACHE_ARCH}"]
  output     = ["type=docker"]
}

target "storefront-ci" {
  inherits   = ["storefront"]
  tags       = ["mze-store-storefront:pr"]
  platforms  = [PLATFORM]
  cache-from = [
    "type=gha,scope=mze-store-storefront-pr-${CACHE_SCOPE}-${CACHE_ARCH}",
    "type=gha,scope=mze-store-storefront-main-${CACHE_ARCH}",
  ]
  cache-to   = ["type=gha,mode=min,scope=mze-store-storefront-pr-${CACHE_SCOPE}-${CACHE_ARCH}"]
  output     = ["type=docker"]
}

target "medusa-release" {
  inherits   = ["medusa"]
  tags       = ["${REGISTRY}/mze-store-medusa:${REVISION}"]
  platforms  = [PLATFORM]
  cache-from = [
    "type=registry,ref=${REGISTRY}/mze-store-medusa:buildcache-${CACHE_ARCH}",
    "type=gha,scope=mze-store-medusa-main-${CACHE_ARCH}",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/mze-store-medusa:buildcache-${CACHE_ARCH},mode=max",
    "type=gha,mode=max,scope=mze-store-medusa-main-${CACHE_ARCH}",
  ]
  output     = ["type=image,push-by-digest=true,name-canonical=true,push=true"]
}

target "storefront-release" {
  inherits   = ["storefront"]
  tags       = ["${REGISTRY}/mze-store-storefront:${REVISION}"]
  platforms  = [PLATFORM]
  cache-from = [
    "type=registry,ref=${REGISTRY}/mze-store-storefront:buildcache-${CACHE_ARCH}",
    "type=gha,scope=mze-store-storefront-main-${CACHE_ARCH}",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/mze-store-storefront:buildcache-${CACHE_ARCH},mode=max",
    "type=gha,mode=max,scope=mze-store-storefront-main-${CACHE_ARCH}",
  ]
  output     = ["type=image,push-by-digest=true,name-canonical=true,push=true"]
}
