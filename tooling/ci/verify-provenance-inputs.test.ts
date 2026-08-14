import { expect, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const verificationScript = fileURLToPath(new URL("./verify-provenance-inputs.sh", import.meta.url));

type BakeAttestation = {
  readonly mode?: string;
  readonly type: string;
};

type BakePlan = {
  readonly target: Readonly<
    Record<
      string,
      {
        readonly args: Readonly<Record<string, string>>;
        readonly attest: ReadonlyArray<BakeAttestation>;
        readonly context: string;
        readonly labels: Readonly<Record<string, string>>;
        readonly tags: ReadonlyArray<string>;
      }
    >
  >;
};

const runVerification = async (plan: BakePlan): Promise<void> => {
  const directory = await mkdtemp(`${tmpdir()}/mze-provenance-inputs-`);
  const planPath = `${directory}/bake-plan.json`;
  await writeFile(planPath, JSON.stringify(plan));
  await execFileAsync("bash", [verificationScript, planPath, "medusa-release"]);
};

const safePlan: BakePlan = {
  target: {
    "medusa-release": {
      args: { SOURCE_DATE_EPOCH: "1786579200" },
      attest: [{ mode: "max", type: "provenance" }, { type: "sbom" }],
      context: ".",
      labels: {
        "org.opencontainers.image.revision": "0123456789abcdef0123456789abcdef01234567",
      },
      tags: ["ghcr.io/hadronomy/mze-store-medusa:0123456789abcdef0123456789abcdef01234567"],
    },
  },
};

it("accepts allowlisted metadata before maximal provenance is enabled", async () => {
  await expect(runVerification(safePlan)).resolves.toBeUndefined();
});

it("rejects sensitive values and unexpected build arguments", async () => {
  await expect(
    runVerification({
      target: {
        "medusa-release": {
          ...safePlan.target["medusa-release"],
          args: { SOURCE_DATE_EPOCH: "1786579200", TOKEN: "github_pat_sensitive-value" },
        },
      },
    }),
  ).rejects.toMatchObject({ code: 1 });

  await expect(
    runVerification({
      target: {
        "medusa-release": {
          ...safePlan.target["medusa-release"],
          labels: { "org.opencontainers.image.note": "sk_live_sensitive-value" },
        },
      },
    }),
  ).rejects.toMatchObject({ code: 1 });
});

it("rejects missing maximal provenance or SBOM configuration", async () => {
  await expect(
    runVerification({
      target: {
        "medusa-release": {
          ...safePlan.target["medusa-release"],
          attest: [{ mode: "min", type: "provenance" }],
        },
      },
    }),
  ).rejects.toMatchObject({ code: 1 });
});
