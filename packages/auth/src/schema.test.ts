import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "vite-plus/test";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "..");
const committedSchemaPath = resolve(packageRoot, "../db/src/schema/auth.ts");

test(
  "Better Auth CLI generates the committed auth schema in the auth namespace",
  { timeout: 30_000 },
  async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "mze-auth-schema-"));
    const generatedSchemaPath = join(temporaryDirectory, "auth.ts");

    try {
      await execFileAsync(
        "auth",
        [
          "generate",
          "--config",
          resolve(packageRoot, "auth.ts"),
          "--output",
          generatedSchemaPath,
          "--yes",
        ],
        {
          cwd: packageRoot,
          env: { ...process.env, BETTER_AUTH_TELEMETRY: "0" },
        },
      );
      await execFileAsync("vp", ["fmt", "--write", generatedSchemaPath], {
        cwd: packageRoot,
      });

      const [generatedSchema, committedSchema] = await Promise.all([
        readFile(generatedSchemaPath, "utf8"),
        readFile(committedSchemaPath, "utf8"),
      ]);

      expect(generatedSchema).toContain('pgSchema("auth")');
      expect(generatedSchema).toBe(committedSchema);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);
