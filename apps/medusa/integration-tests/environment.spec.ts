import { execFileSync } from "node:child_process";

const environmentKeys = [
  "ADMIN_CORS",
  "AUTH_CORS",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CORS_ORIGIN",
  "DATABASE_URL",
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
