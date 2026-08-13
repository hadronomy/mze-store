# CI validates untrusted changes and promotes one signed digest

Pull requests and merge groups run in a read-only trust domain. A trusted `main` workflow builds each image platform once, then scans, tests, attests, signs, and promotes the same image-index digest. This boundary prevents untrusted code from reaching release credentials and prevents a later build from replacing the tested artifact.

## Boundaries

- Vite+ remains the only application task graph.
- GitHub Actions owns events, permissions, merge policy, and release orchestration.
- Docker BuildKit, Buildx, and Bake own container construction, caching, and multi-platform output.
- Native GitHub runners build and smoke amd64 and arm64 images.
- BuildKit creates the SPDX SBOM and provenance. GitHub creates the repository attestation. Keyless Cosign signs the image index.
- The `main` tag moves only after digest, attestation, signer identity, vulnerability, smoke, and size checks pass.

## Consequences

One stable `ci-gate` protects pull requests and Merge Queue groups. Release jobs cannot import pull-request caches. Pull-request jobs cannot push images, request signing identity, or create attestations. A release failure leaves no promoted tag.

Earthly is rejected because it duplicates the Vite+ and Buildx graphs, and its active maintenance ended. Minisign is rejected for images because it requires key custody and does not provide OCI-native identity or transparency evidence.

See [CI and container modernization](../research/ci-container-modernization.md) for measurements, policies, staged changes, and primary sources.
