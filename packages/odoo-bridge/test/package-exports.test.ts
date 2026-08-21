import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));

function runNode(moduleType: "module" | "commonjs", source: string): unknown {
  const output = execFileSync(process.execPath, [`--input-type=${moduleType}`, "--eval", source], {
    cwd: packageDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return JSON.parse(output);
}

for (const moduleType of ["module", "commonjs"] as const) {
  test(`the ${moduleType} package entries load from packed output`, () => {
    expect(
      runNode(
        moduleType,
        moduleType === "module"
          ? `
              const rootPath = import.meta.resolve("@mze-store/odoo-bridge");
              const effectPath = import.meta.resolve("@mze-store/odoo-bridge/effect");
              const contractPath = import.meta.resolve("@mze-store/odoo-bridge/contract");
              const root = await import(rootPath);
              const effect = await import(effectPath);
              const contract = await import(contractPath);
              let promiseAvailable = true;
              try {
                import.meta.resolve("@mze-store/odoo-bridge/promise");
              } catch {
                promiseAvailable = false;
              }
              process.stdout.write(JSON.stringify({
                rootPath,
                effectPath,
                contractPath,
                clientType: typeof root.createOdooBridge,
                errorType: typeof root.TransportFailed,
                effectType: typeof effect.OdooBridge,
                contractType: typeof contract.CatalogBatchSchema,
                promiseAvailable,
                resultType: typeof root.Result,
              }));
            `
          : `
              const rootPath = require.resolve("@mze-store/odoo-bridge");
              const effectPath = require.resolve("@mze-store/odoo-bridge/effect");
              const contractPath = require.resolve("@mze-store/odoo-bridge/contract");
              const root = require(rootPath);
              const effect = require(effectPath);
              const contract = require(contractPath);
              let promiseAvailable = true;
              try {
                require.resolve("@mze-store/odoo-bridge/promise");
              } catch {
                promiseAvailable = false;
              }
              process.stdout.write(JSON.stringify({
                rootPath,
                effectPath,
                contractPath,
                clientType: typeof root.createOdooBridge,
                errorType: typeof root.TransportFailed,
                effectType: typeof effect.OdooBridge,
                contractType: typeof contract.CatalogBatchSchema,
                promiseAvailable,
                resultType: typeof root.Result,
              }));
            `,
      ),
    ).toMatchObject({
      clientType: "function",
      contractPath: expect.stringMatching(
        new RegExp(`/dist/contract\\.${moduleType === "module" ? "mjs" : "cjs"}$`),
      ),
      contractType: "function",
      errorType: "function",
      effectPath: expect.stringMatching(
        new RegExp(`/dist/effect\\.${moduleType === "module" ? "mjs" : "cjs"}$`),
      ),
      effectType: "object",
      promiseAvailable: false,
      resultType: "object",
      rootPath: expect.stringMatching(
        new RegExp(`/dist/index\\.${moduleType === "module" ? "mjs" : "cjs"}$`),
      ),
    });
  });
}
