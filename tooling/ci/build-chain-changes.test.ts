import { expect, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const detectionScript = fileURLToPath(new URL("./detect-build-chain-changes.sh", import.meta.url));

const runGit = async (directory: string, arguments_: ReadonlyArray<string>): Promise<string> => {
  const result = await execFileAsync("git", arguments_, { cwd: directory });
  return result.stdout.trim();
};

const createRepository = async (): Promise<string> => {
  const directory = await mkdtemp(`${tmpdir()}/mze-build-chain-`);
  await runGit(directory, ["init", "--initial-branch", "main"]);
  await runGit(directory, ["config", "user.email", "ci@example.invalid"]);
  await runGit(directory, ["config", "user.name", "CI Test"]);
  const signingKey = `${directory}/signing-key`;
  await execFileAsync("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    "ci@example.invalid",
    "-f",
    signingKey,
  ]);
  await runGit(directory, ["config", "gpg.format", "ssh"]);
  await runGit(directory, ["config", "gpg.ssh.program", "ssh-keygen"]);
  await runGit(directory, ["config", "user.signingkey", signingKey]);
  await runGit(directory, ["config", "commit.gpgsign", "true"]);
  await writeFile(`${directory}/README.md`, "baseline\n");
  await runGit(directory, ["add", "README.md"]);
  await runGit(directory, ["commit", "-m", "baseline"]);
  return directory;
};

const detectChangedPath = async (changedPath: string): Promise<string> => {
  const directory = await createRepository();
  const base = await runGit(directory, ["rev-parse", "HEAD"]);
  const absolutePath = `${directory}/${changedPath}`;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, "changed\n");
  await runGit(directory, ["add", changedPath]);
  await runGit(directory, ["commit", "-m", "change"]);
  const head = await runGit(directory, ["rev-parse", "HEAD"]);
  const outputPath = `${directory}/output.txt`;
  const summaryPath = `${directory}/summary.md`;
  await Promise.all([writeFile(outputPath, ""), writeFile(summaryPath, "")]);

  await execFileAsync(detectionScript, [base, head, outputPath, summaryPath], { cwd: directory });
  return readFile(outputPath, "utf8");
};

it("requires an audit for a changed container build input", async () => {
  await expect(detectChangedPath("apps/medusa/Dockerfile")).resolves.toContain("required=true");
  await expect(detectChangedPath("docker-bake.hcl")).resolves.toContain("required=true");
  await expect(detectChangedPath(".dockerignore")).resolves.toContain("required=true");
  await expect(detectChangedPath("tooling/ci/normalize-storefront-output.mjs")).resolves.toContain(
    "required=true",
  );
});

it("uses a deliberate neutral audit result for an ordinary source change", async () => {
  await expect(detectChangedPath("apps/storefront/src/route.tsx")).resolves.toContain(
    "required=false",
  );
});

it("fails closed for invalid comparison commits", async () => {
  const directory = await createRepository();
  await expect(
    execFileAsync(detectionScript, ["invalid", "also-invalid", "/tmp/output", "/tmp/summary"], {
      cwd: directory,
    }),
  ).rejects.toMatchObject({ code: 1 });
});
