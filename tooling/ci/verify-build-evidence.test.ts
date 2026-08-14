import { expect, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const verificationScript = fileURLToPath(new URL("./verify-build-evidence.sh", import.meta.url));

type JsonValue =
  | boolean
  | number
  | string
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

const runVerification = async (provenance: JsonValue, sbom: JsonValue): Promise<void> => {
  const directory = await mkdtemp(`${tmpdir()}/mze-build-evidence-`);
  const provenancePath = `${directory}/provenance.json`;
  const sbomPath = `${directory}/sbom.json`;
  await Promise.all([
    writeFile(provenancePath, JSON.stringify(provenance)),
    writeFile(sbomPath, JSON.stringify(sbom)),
  ]);
  await execFileAsync(verificationScript, [provenancePath, sbomPath]);
};

it("accepts maximal BuildKit provenance and an SPDX SBOM without sensitive values", async () => {
  await expect(
    runVerification(
      {
        "linux/amd64": {
          SLSA: {
            buildType: "https://mobyproject.org/buildkit@v1",
            invocation: { parameters: { SOURCE_DATE_EPOCH: "1786651200" } },
          },
        },
        "linux/arm64": {
          SLSA: {
            buildType: "https://mobyproject.org/buildkit@v1",
            invocation: { parameters: { SOURCE_DATE_EPOCH: "1786651200" } },
          },
        },
      },
      {
        "linux/amd64": { SPDX: { SPDXID: "SPDXRef-DOCUMENT", spdxVersion: "SPDX-2.3" } },
        "linux/arm64": { SPDX: { SPDXID: "SPDXRef-DOCUMENT", spdxVersion: "SPDX-2.3" } },
      },
    ),
  ).resolves.toBeUndefined();
});

it("rejects evidence that omits either release platform", async () => {
  const provenance = {
    "linux/amd64": {
      SLSA: { buildType: "https://mobyproject.org/buildkit@v1" },
    },
  };
  const sbom = {
    "linux/amd64": { SPDX: { SPDXID: "SPDXRef-DOCUMENT" } },
    "linux/arm64": { SPDX: { SPDXID: "SPDXRef-DOCUMENT" } },
  };

  await expect(runVerification(provenance, sbom)).rejects.toMatchObject({ code: 1 });
  await expect(
    runVerification(
      { ...provenance, "linux/arm64": provenance["linux/amd64"] },
      {
        "linux/amd64": sbom["linux/amd64"],
      },
    ),
  ).rejects.toMatchObject({ code: 1 });
});

it("rejects missing evidence and sensitive provenance values", async () => {
  await expect(runVerification({}, {})).rejects.toMatchObject({ code: 1 });
  await expect(
    runVerification(
      {
        "linux/amd64": {
          SLSA: {
            buildType: "https://mobyproject.org/buildkit@v1",
            invocation: { parameters: { TOKEN: "github_pat_sensitive-value" } },
          },
        },
        "linux/arm64": {
          SLSA: { buildType: "https://mobyproject.org/buildkit@v1" },
        },
      },
      {
        "linux/amd64": { SPDX: { SPDXID: "SPDXRef-DOCUMENT" } },
        "linux/arm64": { SPDX: { SPDXID: "SPDXRef-DOCUMENT" } },
      },
    ),
  ).rejects.toMatchObject({ code: 1 });
});
