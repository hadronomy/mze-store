import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const vitePlusCli = resolve(workspaceRoot, "node_modules/vite-plus/bin/vp");
const executablePath = [
  resolve(workspaceRoot, "packages/auth/node_modules/.bin"),
  resolve(workspaceRoot, "node_modules/.bin"),
  process.env.PATH,
]
  .filter(Boolean)
  .join(delimiter);

function runVitePlus(arguments_: string[]) {
  execFileSync(process.execPath, [vitePlusCli, ...arguments_], {
    cwd: workspaceRoot,
    env: { ...process.env, PATH: executablePath },
    stdio: "inherit",
  });
}

export function setup() {
  process.env.PATH = executablePath;
  runVitePlus(["run", "package-env-build"]);
  runVitePlus(["run", "package-db-build"]);
}
