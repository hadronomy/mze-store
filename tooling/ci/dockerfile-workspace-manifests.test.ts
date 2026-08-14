import { expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";

/**
 * Both Dockerfiles copy every workspace manifest before running
 * `bun install --frozen-lockfile`, so the install layer caches on manifests
 * alone. Bun resolves the whole workspace graph during that install even when
 * `--filter` narrows what gets built, so one missing manifest fails the build
 * outright — and only inside Docker, which is the slowest place to find out.
 *
 * `COPY --parents` with the same globs the workspace uses means adding a
 * package needs no Dockerfile change at all. What can still drift is the globs
 * themselves, so that is what this checks.
 */

const dockerfiles = ["apps/medusa/Dockerfile", "apps/storefront/Dockerfile"];

async function workspaceGlobs(): Promise<ReadonlyArray<string>> {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    readonly workspaces?: ReadonlyArray<string> | { readonly packages?: ReadonlyArray<string> };
  };
  const workspaces = manifest.workspaces;
  const globs = Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? []);
  return globs.map((glob) => `${glob}/package.json`);
}

it.each(dockerfiles)("%s copies manifests with the workspace's own globs", async (path) => {
  const [contents, globs] = await Promise.all([readFile(path, "utf8"), workspaceGlobs()]);

  const copies = [...contents.matchAll(/^COPY --parents (.+) \.\/$/gm)].map((match) => match[1]);
  expect(copies.length).toBeGreaterThan(0);

  for (const copy of copies) {
    expect(copy.split(" ").sort()).toStrictEqual([...globs].sort());
  }

  // An enumerated manifest list is the shape that goes stale. Copying a
  // manifest from an earlier stage is a different thing and stays allowed.
  expect(contents).not.toMatch(/^COPY (?!--from)\S+\/package\.json /m);
});
