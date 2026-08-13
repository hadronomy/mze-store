variable "REGISTRY" {
  default = "ghcr.io/hadronomy"
}

variable "REVISION" {
  default = "local"
}

variable "CREATED" {
  default = "1970-01-01T00:00:00Z"
}

variable "SOURCE_DATE_EPOCH" {
  default = "0"
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

variable "OUTPUT_PATH" {
  default = "mze-image.oci.tar"
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

group "audit" {
  targets = ["medusa-audit", "storefront-audit"]
}

target "_common" {
  context = "."
  args = {
    SOURCE_DATE_EPOCH = SOURCE_DATE_EPOCH
  }
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
  tags       = ["${REGISTRY}/mze-store-medusa"]
  platforms  = [PLATFORM]
  cache-from = [
    "type=registry,ref=${REGISTRY}/mze-store-medusa:buildcache-${CACHE_ARCH}",
    "type=gha,scope=mze-store-medusa-main-${CACHE_ARCH}",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/mze-store-medusa:buildcache-${CACHE_ARCH},mode=max",
    "type=gha,mode=max,scope=mze-store-medusa-main-${CACHE_ARCH}",
  ]
  output     = ["type=image,push-by-digest=true,name-canonical=true,push=true,rewrite-timestamp=true"]
}

target "storefront-release" {
  inherits   = ["storefront"]
  tags       = ["${REGISTRY}/mze-store-storefront"]
  platforms  = [PLATFORM]
  cache-from = [
    "type=registry,ref=${REGISTRY}/mze-store-storefront:buildcache-${CACHE_ARCH}",
    "type=gha,scope=mze-store-storefront-main-${CACHE_ARCH}",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/mze-store-storefront:buildcache-${CACHE_ARCH},mode=max",
    "type=gha,mode=max,scope=mze-store-storefront-main-${CACHE_ARCH}",
  ]
  output     = ["type=image,push-by-digest=true,name-canonical=true,push=true,rewrite-timestamp=true"]
}

target "medusa-audit" {
  inherits  = ["medusa"]
  platforms = [PLATFORM]
  no-cache  = true
  output    = ["type=oci,dest=${OUTPUT_PATH},rewrite-timestamp=true"]
}

target "storefront-audit" {
  inherits  = ["storefront"]
  platforms = [PLATFORM]
  no-cache  = true
  output    = ["type=oci,dest=${OUTPUT_PATH},rewrite-timestamp=true"]
}
