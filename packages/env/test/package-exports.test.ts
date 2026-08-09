import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
const environment = {
  ...process.env,
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  CORS_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/mze-store",
  DOTENV_CONFIG_QUIET: "true",
  NODE_ENV: "test",
};

function runNode(moduleType: "module" | "commonjs", source: string) {
  const output = execFileSync(process.execPath, [`--input-type=${moduleType}`, "--eval", source], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: environment,
  });

  return JSON.parse(output) as { modulePath: string; nodeEnv: string };
}

test("the server entry loads as built ESM", () => {
  const loadedEntry = runNode(
    "module",
    `
        const modulePath = import.meta.resolve("@mze-store/env/server");
        const { env } = await import(modulePath);
        process.stdout.write(JSON.stringify({ modulePath, nodeEnv: env.NODE_ENV }));
      `,
  );

  expect(loadedEntry).toMatchObject({
    modulePath: expect.stringMatching(/\/dist\/server\.mjs$/),
    nodeEnv: "test",
  });
});

test("the server entry loads as built CommonJS", () => {
  const loadedEntry = runNode(
    "commonjs",
    `
        const modulePath = require.resolve("@mze-store/env/server");
        const { env } = require(modulePath);
        process.stdout.write(JSON.stringify({ modulePath, nodeEnv: env.NODE_ENV }));
      `,
  );

  expect(loadedEntry).toMatchObject({
    modulePath: expect.stringMatching(/\/dist\/server\.cjs$/),
    nodeEnv: "test",
  });
});
