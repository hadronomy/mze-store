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

  return JSON.parse(output) as Record<string, number | string>;
}

test("the package root loads as built ESM", () => {
  expect(
    runNode(
      "module",
      `
        const modulePath = import.meta.resolve("@mze-store/territory");
        const { createProvinceCodeSchema } = await import(modulePath);
        process.stdout.write(JSON.stringify({
          exportType: typeof createProvinceCodeSchema,
          modulePath,
        }));
      `,
    ),
  ).toMatchObject({
    exportType: "function",
    modulePath: expect.stringMatching(/\/dist\/index\.mjs$/),
  });
});

test("the package root loads as built CommonJS", () => {
  expect(
    runNode(
      "commonjs",
      `
        const modulePath = require.resolve("@mze-store/territory");
        const { createProvinceCodeSchema } = require(modulePath);
        process.stdout.write(JSON.stringify({
          exportType: typeof createProvinceCodeSchema,
          modulePath,
        }));
      `,
    ),
  ).toMatchObject({
    exportType: "function",
    modulePath: expect.stringMatching(/\/dist\/index\.cjs$/),
  });
});

test("the Spain entry loads as built ESM", () => {
  expect(
    runNode(
      "module",
      `
        const modulePath = import.meta.resolve("@mze-store/territory/spain");
        const Spain = await import(modulePath);
        process.stdout.write(JSON.stringify({
          country: Spain.country,
          modulePath,
          parsed: Spain.provinceCodeSchema.parse("es-gc"),
          provinceCount: Spain.provinces.length,
        }));
      `,
    ),
  ).toMatchObject({
    country: "es",
    modulePath: expect.stringMatching(/\/dist\/spain\.mjs$/),
    parsed: "es-gc",
    provinceCount: 52,
  });
});

test("the Spain entry loads as built CommonJS", () => {
  expect(
    runNode(
      "commonjs",
      `
        const modulePath = require.resolve("@mze-store/territory/spain");
        const Spain = require(modulePath);
        process.stdout.write(JSON.stringify({
          country: Spain.country,
          modulePath,
          parsed: Spain.provinceCodeSchema.parse("es-gc"),
          provinceCount: Spain.provinces.length,
        }));
      `,
    ),
  ).toMatchObject({
    country: "es",
    modulePath: expect.stringMatching(/\/dist\/spain\.cjs$/),
    parsed: "es-gc",
    provinceCount: 52,
  });
});
