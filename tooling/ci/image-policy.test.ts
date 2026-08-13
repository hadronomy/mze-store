import { expect, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const measureScript = fileURLToPath(new URL("./measure-image.sh", import.meta.url));
const policyScript = fileURLToPath(new URL("./enforce-image-policy.sh", import.meta.url));

const runPolicy = async (options: {
  readonly exceptions?: ReadonlyArray<Record<string, string>>;
  readonly vulnerabilities: ReadonlyArray<Record<string, string>>;
  readonly withinBudget?: boolean;
}): Promise<void> => {
  const directory = await mkdtemp(`${tmpdir()}/mze-image-policy-`);
  const paths = {
    exceptions: `${directory}/exceptions.json`,
    policy: `${directory}/policy.json`,
    scan: `${directory}/scan.json`,
    size: `${directory}/size.json`,
    version: `${directory}/version.json`,
  };

  await Promise.all([
    writeFile(paths.exceptions, JSON.stringify(options.exceptions ?? [])),
    writeFile(
      paths.scan,
      JSON.stringify({ Results: [{ Vulnerabilities: options.vulnerabilities }] }),
    ),
    writeFile(
      paths.size,
      JSON.stringify({
        compressedBudget: 230_000_000,
        compressedBytes: 200_000_000,
        uncompressedBudget: 900_000_000,
        uncompressedBytes: 800_000_000,
        withinBudget: options.withinBudget ?? true,
      }),
    ),
    writeFile(paths.version, JSON.stringify({ Version: "0.70.0" })),
  ]);

  await execFileAsync(
    policyScript,
    [
      "medusa",
      "linux/amd64",
      paths.scan,
      paths.size,
      paths.exceptions,
      paths.version,
      paths.policy,
    ],
    { env: { ...process.env, POLICY_TODAY: "2026-08-13" } },
  );
};

it("blocks fixable critical and unexcepted high findings", async () => {
  const fixedHigh = {
    FixedVersion: "2.0.0",
    PkgName: "example-high",
    Severity: "HIGH",
    VulnerabilityID: "CVE-2026-0001",
  };
  const fixedCritical = {
    FixedVersion: "3.0.0",
    PkgName: "example-critical",
    Severity: "CRITICAL",
    VulnerabilityID: "CVE-2026-0002",
  };

  await expect(runPolicy({ vulnerabilities: [fixedHigh] })).rejects.toMatchObject({ code: 1 });
  await expect(runPolicy({ vulnerabilities: [fixedCritical] })).rejects.toMatchObject({ code: 1 });
});

it("accepts an owned, reasoned, unexpired high exception", async () => {
  await expect(
    runPolicy({
      exceptions: [
        {
          expires: "2026-09-13",
          id: "CVE-2026-0001",
          image: "medusa",
          owner: "@hadronomy",
          package: "example-high",
          reason: "Existing finding at policy adoption.",
        },
      ],
      vulnerabilities: [
        {
          FixedVersion: "2.0.0",
          PkgName: "example-high",
          Severity: "HIGH",
          VulnerabilityID: "CVE-2026-0001",
        },
        {
          FixedVersion: "",
          PkgName: "visible-unfixed",
          Severity: "CRITICAL",
          VulnerabilityID: "CVE-2026-0003",
        },
      ],
    }),
  ).resolves.toBeUndefined();
});

it("rejects incomplete or expired vulnerability exceptions", async () => {
  await expect(
    runPolicy({
      exceptions: [
        {
          expires: "2026-08-12",
          id: "CVE-2026-0001",
          image: "medusa",
          owner: "",
          package: "example-high",
          reason: "",
        },
      ],
      vulnerabilities: [],
    }),
  ).rejects.toMatchObject({ code: 1 });
});

it("blocks an image that exceeds either fixed size budget", async () => {
  await expect(runPolicy({ vulnerabilities: [], withinBudget: false })).rejects.toMatchObject({
    code: 1,
  });
});

it("measures the selected platform manifest when the digest is an image index", async () => {
  const directory = await mkdtemp(`${tmpdir()}/mze-measure-image-`);
  const docker = `${directory}/docker`;
  const output = `${directory}/size.json`;
  const indexDigest = `sha256:${"a".repeat(64)}`;
  const amd64Digest = `sha256:${"b".repeat(64)}`;
  const arm64Digest = `sha256:${"c".repeat(64)}`;

  await writeFile(
    docker,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == "image inspect --format {{.Size}} ghcr.io/example/mze-store-medusa@${indexDigest}" ]]; then
  echo 800000000
elif [[ "$*" == "buildx imagetools inspect ghcr.io/example/mze-store-medusa@${indexDigest} --raw" ]]; then
  printf '%s\\n' '{"manifests":[{"digest":"${amd64Digest}","platform":{"os":"linux","architecture":"amd64"}},{"digest":"${arm64Digest}","platform":{"os":"linux","architecture":"arm64"}}]}'
elif [[ "$*" == "buildx imagetools inspect ghcr.io/example/mze-store-medusa@${arm64Digest} --raw" ]]; then
  printf '%s\\n' '{"layers":[{"size":100},{"size":200}]}'
else
  exit 64
fi
`,
    { mode: 0o755 },
  );

  await execFileAsync(
    measureScript,
    [`ghcr.io/example/mze-store-medusa@${indexDigest}`, "medusa", "linux/arm64", output],
    { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } },
  );

  await expect(readFile(output, "utf8").then(JSON.parse)).resolves.toMatchObject({
    compressedBytes: 300,
    platform: "linux/arm64",
  });
});
