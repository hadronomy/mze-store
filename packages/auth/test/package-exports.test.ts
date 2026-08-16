import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
const environment = {
  ...process.env,
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3001",
  CORS_ORIGIN: "http://localhost:3001",
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/mze-store",
  NODE_ENV: "test",
};

function runNode(source: string) {
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return JSON.parse(output) as Record<string, string>;
}

test("the package root loads as built ESM", () => {
  expect(
    runNode(`
      const modulePath = import.meta.resolve("@mze-store/auth");
      const { createAuth } = await import(modulePath);
      process.stdout.write(JSON.stringify({
        exportType: typeof createAuth,
        modulePath,
      }));
    `),
  ).toMatchObject({
    exportType: "function",
    modulePath: expect.stringMatching(/\/dist\/src\/index\.js$/),
  });
});

test("the lazy instance entry loads as built ESM", () => {
  expect(
    runNode(`
      const modulePath = import.meta.resolve("@mze-store/auth/instance");
      const { getAuth } = await import(modulePath);
      process.stdout.write(JSON.stringify({
        exportType: typeof getAuth,
        modulePath,
      }));
    `),
  ).toMatchObject({
    exportType: "function",
    modulePath: expect.stringMatching(/\/dist\/src\/instance\.js$/),
  });
});

test("the Better Auth CLI entry loads as built ESM", () => {
  expect(
    runNode(`
      const modulePath = import.meta.resolve("@mze-store/auth/auth");
      const { auth } = await import(modulePath);
      process.stdout.write(JSON.stringify({
        exportType: typeof auth,
        modulePath,
      }));
    `),
  ).toMatchObject({
    exportType: "object",
    modulePath: expect.stringMatching(/\/dist\/auth\.js$/),
  });
});
