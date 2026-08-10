import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
const environment = {
  ...process.env,
  ADMIN_CORS: "http://localhost:9000",
  AUTH_CORS: "http://localhost:3001,http://localhost:9000",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  COOKIE_SECRET: "test-cookie-secret",
  CORS_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/mze-store",
  DOTENV_CONFIG_QUIET: "true",
  JWT_SECRET: "test-jwt-secret",
  NODE_ENV: "test",
  REDIS_URL: "redis://localhost:6379",
  SKIP_ENV_VALIDATION: undefined,
  STORE_CORS: "http://localhost:3001",
  STRIPE_API_KEY: "sk_test_integration",
};
const commonJsServerSource = `
  const modulePath = require.resolve("@mze-store/env/server");
  const { env } = require(modulePath);
  process.stdout.write(JSON.stringify({ modulePath, nodeEnv: env.NODE_ENV }));
`;

function runNode(
  moduleType: "module" | "commonjs",
  source: string,
  environmentVariables: NodeJS.ProcessEnv = environment,
) {
  const output = execFileSync(process.execPath, [`--input-type=${moduleType}`, "--eval", source], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: environmentVariables,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return JSON.parse(output) as Record<string, string>;
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
  const loadedEntry = runNode("commonjs", commonJsServerSource);

  expect(loadedEntry).toMatchObject({
    modulePath: expect.stringMatching(/\/dist\/server\.cjs$/),
    nodeEnv: "test",
  });
});

test("the server entry uses the Portless URL for local development origins", () => {
  const loadedEntry = runNode(
    "module",
    `
        const modulePath = import.meta.resolve("@mze-store/env/server");
        const { env } = await import(modulePath);
        process.stdout.write(JSON.stringify({
          betterAuthUrl: env.BETTER_AUTH_URL,
          corsOrigin: env.CORS_ORIGIN,
          portlessUrl: env.PORTLESS_URL,
        }));
      `,
    {
      ...environment,
      CI: undefined,
      NODE_ENV: "development",
      PORTLESS_URL: "https://feature.storefront.mze-store.localhost",
    },
  );

  expect(loadedEntry).toMatchObject({
    betterAuthUrl: "https://feature.storefront.mze-store.localhost",
    corsOrigin: "https://feature.storefront.mze-store.localhost",
    portlessUrl: "https://feature.storefront.mze-store.localhost",
  });
});

test("the server entry keeps explicit origins outside local development", () => {
  const loadedEntry = runNode(
    "module",
    `
        const modulePath = import.meta.resolve("@mze-store/env/server");
        const { env } = await import(modulePath);
        process.stdout.write(JSON.stringify({
          betterAuthUrl: env.BETTER_AUTH_URL,
          corsOrigin: env.CORS_ORIGIN,
        }));
      `,
    {
      ...environment,
      BETTER_AUTH_URL: "https://store.example",
      CORS_ORIGIN: "https://store.example",
      NODE_ENV: "production",
      PORTLESS_URL: "https://feature.storefront.mze-store.localhost",
    },
  );

  expect(loadedEntry).toMatchObject({
    betterAuthUrl: "https://store.example",
    corsOrigin: "https://store.example",
  });
});

test("the server entry keeps the storefront environment contract", () => {
  expect(
    runNode("commonjs", commonJsServerSource, {
      ...environment,
      ADMIN_CORS: undefined,
      AUTH_CORS: undefined,
      STORE_CORS: undefined,
    }),
  ).toMatchObject({ nodeEnv: "test" });
});

test("the Medusa entry loads as built ESM without validation", () => {
  expect(
    runNode(
      "module",
      `
        const modulePath = import.meta.resolve("@mze-store/env/medusa");
        const { parse } = await import(modulePath);
        process.stdout.write(JSON.stringify({ modulePath, exportType: typeof parse }));
      `,
      {
        ...environment,
        ADMIN_CORS: undefined,
        AUTH_CORS: undefined,
        DATABASE_URL: undefined,
        STORE_CORS: undefined,
      },
    ),
  ).toMatchObject({
    modulePath: expect.stringMatching(/\/dist\/medusa\.mjs$/),
    exportType: "function",
  });
});

test("the Medusa entry loads as built CommonJS without validation", () => {
  expect(
    runNode(
      "commonjs",
      `
        const modulePath = require.resolve("@mze-store/env/medusa");
        const { parse } = require(modulePath);
        process.stdout.write(JSON.stringify({ modulePath, exportType: typeof parse }));
      `,
      {
        ...environment,
        ADMIN_CORS: undefined,
        AUTH_CORS: undefined,
        DATABASE_URL: undefined,
        STORE_CORS: undefined,
      },
    ),
  ).toMatchObject({
    modulePath: expect.stringMatching(/\/dist\/medusa\.cjs$/),
    exportType: "function",
  });
});

test("the Medusa parser names a missing STORE_CORS variable", () => {
  expect(() =>
    runNode(
      "commonjs",
      `
        const { parse } = require("@mze-store/env/medusa");
        parse(process.env);
        process.stdout.write("{}");
      `,
      {
        ...environment,
        STORE_CORS: undefined,
      },
    ),
  ).toThrow(/STORE_CORS/);
});

test.each(["COOKIE_SECRET", "JWT_SECRET", "REDIS_URL", "STRIPE_API_KEY"] as const)(
  "the Medusa parser names a missing %s variable",
  (key) => {
    expect(() =>
      runNode(
        "commonjs",
        `
          const { parse } = require("@mze-store/env/medusa");
          parse(process.env);
          process.stdout.write("{}");
        `,
        {
          ...environment,
          [key]: undefined,
        },
      ),
    ).toThrow(new RegExp(key));
  },
);

test("the Medusa parser rejects a Stripe publishable key", () => {
  expect(() =>
    runNode(
      "commonjs",
      `
        const { parse } = require("@mze-store/env/medusa");
        parse(process.env);
        process.stdout.write("{}");
      `,
      {
        ...environment,
        STRIPE_API_KEY: "pk_test_integration",
      },
    ),
  ).toThrow(/STRIPE_API_KEY must be a Stripe secret key/);
});
