import { execFileSync } from "node:child_process";
import { parseCorsOrigins } from "@medusajs/framework/utils";
import { portlessCors, withPortlessCors } from "~/portless";

const environmentKeys = [
  "ADMIN_CORS",
  "AUTH_CORS",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CORS_ORIGIN",
  "DATABASE_URL",
  "PORTLESS_URL",
  "STORE_CORS",
] as const;

function loadEnvironmentFile(fileName: string) {
  const childEnvironment = {
    ...process.env,
    DOTENV_CONFIG_PATH: fileName,
    DOTENV_CONFIG_QUIET: "true",
  };

  for (const key of environmentKeys) {
    delete childEnvironment[key];
  }
  delete childEnvironment.SKIP_ENV_VALIDATION;

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "--eval",
      `
        const { env } = require("@mze-store/env/server");
        const { parse } = require("@mze-store/env/medusa");
        process.stdout.write(JSON.stringify({ ...env, ...parse(process.env) }));
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: childEnvironment,
    },
  );

  return JSON.parse(output) as Record<string, string>;
}

test.each([".env.template", ".env.test"])(
  "%s satisfies the server environment schema",
  (fileName) => {
    expect(loadEnvironmentFile(fileName)).toMatchObject({
      ADMIN_CORS: "http://localhost:9000",
      AUTH_CORS: "http://localhost:3001,http://localhost:9000",
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/mze-store",
      STORE_CORS: "http://localhost:3001",
    });
  },
);

test("Portless development uses named local CORS patterns", () => {
  const source = {
    ADMIN_CORS: "http://localhost:9000",
    AUTH_CORS: "http://localhost:3001,http://localhost:9000",
    NODE_ENV: "development",
    PORTLESS_URL: "https://medusa.mze-store.localhost",
    STORE_CORS: "http://localhost:3001",
  };

  expect(withPortlessCors(source)).toMatchObject({
    ADMIN_CORS: portlessCors.admin,
    AUTH_CORS: portlessCors.auth,
    STORE_CORS: portlessCors.store,
  });

  const [storeOrigin] = parseCorsOrigins(portlessCors.store);
  const [adminOrigin] = parseCorsOrigins(portlessCors.admin);
  if (!(storeOrigin instanceof RegExp) || !(adminOrigin instanceof RegExp)) {
    throw new Error("Portless CORS values must parse as regular expressions");
  }

  expect(storeOrigin.test("https://storefront.mze-store.localhost")).toBe(true);
  expect(storeOrigin.test("https://e180a347.storefront.mze-store.localhost")).toBe(true);
  expect(storeOrigin.test("https://other.example")).toBe(false);
  expect(adminOrigin.test("https://medusa.mze-store.localhost")).toBe(true);
  expect(adminOrigin.test("https://e180a347.medusa.mze-store.localhost")).toBe(false);
});

test("Portless CORS patterns do not change production values", () => {
  const source = {
    ADMIN_CORS: "https://admin.example",
    AUTH_CORS: "https://store.example,https://admin.example",
    NODE_ENV: "production",
    PORTLESS_URL: "https://medusa.mze-store.localhost",
    STORE_CORS: "https://store.example",
  };

  expect(withPortlessCors(source)).toEqual(source);
});
