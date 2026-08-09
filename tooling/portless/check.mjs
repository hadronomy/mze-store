import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_PORTLESS_VERSION = "0.15.5";

const installCommand = `bun add --global portless@${REQUIRED_PORTLESS_VERSION}`;

function defaultExecutable() {
  return process.platform === "win32" ? "portless.cmd" : "portless";
}

function extractVersion(output) {
  return output.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0];
}

export function assertPortlessVersion({
  executable = defaultExecutable(),
  run = (command, args) =>
    spawnSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
} = {}) {
  const result = run(executable, ["--version"]);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();

  if (result.error || result.status !== 0) {
    const detail = result.error?.message || output || "the command failed";
    throw new Error(
      `Portless ${REQUIRED_PORTLESS_VERSION} is required, but ${executable} is not available (${detail}). Install it with: ${installCommand}`,
    );
  }

  const version = extractVersion(output);

  if (version !== REQUIRED_PORTLESS_VERSION) {
    throw new Error(
      `Portless ${REQUIRED_PORTLESS_VERSION} is required, but ${version ?? "no version was reported"} was found. Install it with: ${installCommand}`,
    );
  }

  return version;
}

const invokedPath = process.argv[1];
const isInvokedDirectly =
  invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href;

if (isInvokedDirectly) {
  try {
    assertPortlessVersion();
    console.log(`Portless ${REQUIRED_PORTLESS_VERSION} is available.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
