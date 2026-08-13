import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));

function runNode(source: string) {
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: packageDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return JSON.parse(output) as Record<string, string>;
}

test("the package root loads as built ESM", () => {
  expect(
    runNode(`
      const modulePath = import.meta.resolve("@mze-store/db");
      const { createDb } = await import(modulePath);
      process.stdout.write(JSON.stringify({
        exportType: typeof createDb,
        modulePath,
      }));
    `),
  ).toMatchObject({
    exportType: "function",
    modulePath: expect.stringMatching(/\/dist\/src\/index\.js$/),
  });
});

test("the schema entry loads as built ESM", () => {
  expect(
    runNode(`
      const modulePath = import.meta.resolve("@mze-store/db/schema");
      const { user } = await import(modulePath);
      process.stdout.write(JSON.stringify({
        exportType: typeof user,
        modulePath,
      }));
    `),
  ).toMatchObject({
    exportType: "object",
    modulePath: expect.stringMatching(/\/dist\/src\/schema\/index\.js$/),
  });
});

test("the auth schema entry loads as built ESM", () => {
  expect(
    runNode(`
      const modulePath = import.meta.resolve("@mze-store/db/schema/auth");
      const { user } = await import(modulePath);
      process.stdout.write(JSON.stringify({
        exportType: typeof user,
        modulePath,
      }));
    `),
  ).toMatchObject({
    exportType: "object",
    modulePath: expect.stringMatching(/\/dist\/src\/schema\/auth\.js$/),
  });
});
