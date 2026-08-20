import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));

function runNode(moduleType: "module" | "commonjs", source: string) {
  const output = execFileSync(process.execPath, [`--input-type=${moduleType}`, "--eval", source], {
    cwd: packageDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return JSON.parse(output) as Record<string, string>;
}

for (const moduleType of ["module", "commonjs"] as const) {
  test(`the ${moduleType} package edges load from packed output`, () => {
    expect(
      runNode(
        moduleType,
        moduleType === "module"
          ? `
              const rootPath = import.meta.resolve("@mze-store/odoo-bridge");
              const promisePath = import.meta.resolve("@mze-store/odoo-bridge/promise");
              const root = await import(rootPath);
              const promise = await import(promisePath);
              process.stdout.write(JSON.stringify({
                rootPath,
                promisePath,
                bridgeType: typeof root.OdooBridge,
                promiseType: typeof promise.createPromiseBridge,
              }));
            `
          : `
              const rootPath = require.resolve("@mze-store/odoo-bridge");
              const promisePath = require.resolve("@mze-store/odoo-bridge/promise");
              const root = require(rootPath);
              const promise = require(promisePath);
              process.stdout.write(JSON.stringify({
                rootPath,
                promisePath,
                bridgeType: typeof root.OdooBridge,
                promiseType: typeof promise.createPromiseBridge,
              }));
            `,
      ),
    ).toMatchObject({
      bridgeType: "function",
      promiseType: "function",
      rootPath: expect.stringMatching(
        new RegExp(`/dist/index\\.${moduleType === "module" ? "mjs" : "cjs"}$`),
      ),
      promisePath: expect.stringMatching(
        new RegExp(`/dist/promise\\.${moduleType === "module" ? "mjs" : "cjs"}$`),
      ),
    });
  });
}
