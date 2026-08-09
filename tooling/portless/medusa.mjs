import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const routeConflict = '"medusa.mze-store.localhost" is already registered by a running process';

export function isMedusaRouteConflict(output) {
  return output.includes(routeConflict);
}

export const medusaRouteConflictMessage =
  "The shared Medusa URL is in use. Run `bun run dev:portless:storefront` for a Storefront-only process. Do not use `--force`.";

function defaultExecutable() {
  return process.platform === "win32" ? "portless.cmd" : "portless";
}

function runMedusa() {
  const child = spawn(defaultExecutable(), ["medusa.mze-store", "medusa", "develop"], {
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  let output = "";

  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
    process.stderr.write(chunk);
  });

  const forwardSignal = (signal) => child.kill(signal);
  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  child.on("error", (error) => {
    process.removeListener("SIGINT", forwardSignal);
    process.removeListener("SIGTERM", forwardSignal);
    console.error(`Could not run Portless: ${error.message}`);
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    process.removeListener("SIGINT", forwardSignal);
    process.removeListener("SIGTERM", forwardSignal);

    if (isMedusaRouteConflict(output)) {
      console.error(medusaRouteConflictMessage);
    }

    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

const invokedPath = process.argv[1];
const isInvokedDirectly =
  invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href;

if (isInvokedDirectly) {
  runMedusa();
}
