import { expect, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const comparisonScript = fileURLToPath(new URL("./compare-image-builds.sh", import.meta.url));

const manifest = (layer: string) => ({
  config: { digest: "sha256:config" },
  layers: [{ digest: layer, size: 100 }],
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  schemaVersion: 2,
});

it("accepts identical image manifests and records layer evidence", async () => {
  const directory = await mkdtemp(`${tmpdir()}/mze-reproducibility-`);
  const first = `${directory}/first.json`;
  const firstIndex = `${directory}/first-index.json`;
  const second = `${directory}/second.json`;
  const secondIndex = `${directory}/second-index.json`;
  const evidence = `${directory}/evidence.json`;
  await Promise.all([
    writeFile(first, JSON.stringify(manifest("sha256:layer"))),
    writeFile(firstIndex, JSON.stringify({ manifests: [{ digest: "sha256:manifest" }] })),
    writeFile(second, JSON.stringify(manifest("sha256:layer"))),
    writeFile(secondIndex, JSON.stringify({ manifests: [{ digest: "sha256:manifest" }] })),
  ]);

  await execFileAsync(comparisonScript, [
    "medusa",
    "linux/amd64",
    firstIndex,
    first,
    secondIndex,
    second,
    evidence,
  ]);

  expect(JSON.parse(await readFile(evidence, "utf8"))).toMatchObject({
    image: "medusa",
    matches: true,
    platform: "linux/amd64",
  });
});

it("rejects a layer digest mismatch and keeps mismatch evidence", async () => {
  const directory = await mkdtemp(`${tmpdir()}/mze-reproducibility-`);
  const first = `${directory}/first.json`;
  const firstIndex = `${directory}/first-index.json`;
  const second = `${directory}/second.json`;
  const secondIndex = `${directory}/second-index.json`;
  const evidence = `${directory}/evidence.json`;
  await Promise.all([
    writeFile(first, JSON.stringify(manifest("sha256:first"))),
    writeFile(firstIndex, JSON.stringify({ manifests: [{ digest: "sha256:first-manifest" }] })),
    writeFile(second, JSON.stringify(manifest("sha256:second"))),
    writeFile(secondIndex, JSON.stringify({ manifests: [{ digest: "sha256:second-manifest" }] })),
  ]);

  await expect(
    execFileAsync(comparisonScript, [
      "storefront",
      "linux/arm64",
      firstIndex,
      first,
      secondIndex,
      second,
      evidence,
    ]),
  ).rejects.toMatchObject({ code: 1 });
  expect(JSON.parse(await readFile(evidence, "utf8"))).toMatchObject({ matches: false });
});
