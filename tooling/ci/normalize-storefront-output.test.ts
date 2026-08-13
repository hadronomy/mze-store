import { expect, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const normalizationScript = fileURLToPath(
  new URL("./normalize-storefront-output.mjs", import.meta.url),
);

const serverFixture = `//#region #nitro/virtual/public-assets-data
var public_assets_data_default = {
\t"/assets/z.js": {
\t\t"mtime": "2026-08-13T22:40:57.063Z",
\t\t"path": "../public/assets/z.js"
\t},
\t"/assets/a.js": {
\t\t"mtime": "2026-08-13T22:40:55.585Z",
\t\t"path": "../public/assets/a.js"
\t}
};
//#endregion
`;

it("normalizes Nitro build dates and public asset metadata", async () => {
  const directory = await mkdtemp(`${tmpdir()}/mze-storefront-output-`);
  await mkdir(`${directory}/server`);
  await Promise.all([
    writeFile(
      `${directory}/nitro.json`,
      JSON.stringify({ date: "2026-08-13T22:40:56.254Z", serverEntry: "server/index.mjs" }),
    ),
    writeFile(`${directory}/server/index.mjs`, serverFixture),
  ]);

  await execFileAsync(process.execPath, [normalizationScript, directory, "1786651200"]);
  const firstServer = await readFile(`${directory}/server/index.mjs`, "utf8");
  const firstBuildInfo = await readFile(`${directory}/nitro.json`, "utf8");

  expect(JSON.parse(firstBuildInfo)).toMatchObject({ date: "2026-08-13T20:00:00.000Z" });
  expect(firstServer.indexOf('"/assets/a.js"')).toBeLessThan(firstServer.indexOf('"/assets/z.js"'));
  expect(firstServer.match(/2026-08-13T20:00:00.000Z/gu)).toHaveLength(2);

  await execFileAsync(process.execPath, [normalizationScript, directory, "1786651200"]);
  await expect(readFile(`${directory}/server/index.mjs`, "utf8")).resolves.toBe(firstServer);
  await expect(readFile(`${directory}/nitro.json`, "utf8")).resolves.toBe(firstBuildInfo);
});

it("rejects an invalid source date", async () => {
  await expect(
    execFileAsync(process.execPath, [normalizationScript, "/tmp/mze-missing-output", "invalid"]),
  ).rejects.toMatchObject({ code: 1 });
});
