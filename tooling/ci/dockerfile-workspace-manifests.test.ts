import { expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";

/**
 * Both Dockerfiles copy every workspace manifest before running
 * `bun install --frozen-lockfile`, so the install layer caches on manifests
 * alone. Bun resolves the whole workspace graph during that install even when
 * `--filter` narrows what gets built, so one missing manifest fails the build
 * outright — and only inside Docker, which is the slowest place to find out.
 *
 * One recursive `COPY --parents **\/package.json` means adding a package needs
 * no Dockerfile change at all, wherever it goes. `.dockerignore` excludes
 * node_modules, which is what makes the recursive glob safe. What can still
 * drift is that line itself, so that is what these check.
 */

const dockerfiles = ["apps/medusa/Dockerfile", "apps/storefront/Dockerfile"];

async function workspaceEntries(): Promise<ReadonlyArray<string>> {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    readonly workspaces?: ReadonlyArray<string> | { readonly packages?: ReadonlyArray<string> };
  };
  const workspaces = manifest.workspaces;
  return Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? []);
}

/**
 * The Dockerfiles no longer depend on this, but a reader adding a package still
 * should not have to touch the root manifest. `tooling/mze` named one package;
 * `tooling/*` names the directory and never changes again.
 */
it("declares every workspace as a directory glob", async () => {
  const entries = await workspaceEntries();

  expect(entries.length).toBeGreaterThan(0);
  expect(entries.filter((entry) => !entry.endsWith("/*"))).toStrictEqual([]);
});

it.each(dockerfiles)("%s copies every manifest with one recursive glob", async (path) => {
  const contents = await readFile(path, "utf8");

  const copies = [...contents.matchAll(/^COPY --parents (.+) \.\/$/gm)].map((match) => match[1]);
  expect(copies.length).toBeGreaterThan(0);

  for (const copy of copies) {
    expect(copy).toBe("**/package.json");
  }

  // An enumerated manifest list is the shape that goes stale. Copying a
  // manifest from an earlier stage is a different thing and stays allowed.
  expect(contents).not.toMatch(/^COPY (?!--from)\S+\/package\.json /m);
});
