import { expect, test } from "vitest";

const authModuleUrl = new URL("./index.ts", import.meta.url).href;
const baseURL = "http://localhost:3000";
const environmentKeys = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CORS_ORIGIN",
] as const;

async function postJson(
  auth: { handler(request: Request): Promise<Response> },
  path: string,
  body: unknown,
) {
  return auth.handler(
    new Request(`${baseURL}/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("the root entry imports without database or auth environment variables", async () => {
  const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

  try {
    for (const key of environmentKeys) {
      delete process.env[key];
    }

    await import(`${authModuleUrl}?without-environment`);
  } finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("an in-memory Account survives sign-up, sign-in, and a session read", async () => {
  const { createAuth } = await import(authModuleUrl);
  const auth = createAuth({
    secret: "test-secret-with-at-least-32-characters",
    baseURL,
    trustedOrigins: [baseURL],
  });
  const email = "shopper@example.com";
  const password = "account-password";

  const signUpResponse = await postJson(auth, "sign-up/email", {
    name: "Test Shopper",
    email,
    password,
  });
  expect(signUpResponse.status).toBe(200);

  const signInResponse = await postJson(auth, "sign-in/email", { email, password });
  expect(signInResponse.status).toBe(200);

  const cookie = signInResponse.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  expect(cookie).not.toBe("");

  const sessionResponse = await auth.handler(
    new Request(`${baseURL}/api/auth/get-session`, {
      headers: { cookie },
    }),
  );
  expect(sessionResponse.status).toBe(200);

  const session: unknown = await sessionResponse.json();
  expect(session).toMatchObject({ user: { email } });
});
