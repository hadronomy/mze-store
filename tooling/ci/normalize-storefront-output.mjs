import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = process.argv[2];
const sourceDateEpoch = process.argv[3];

if (!outputDirectory || !sourceDateEpoch || !/^[0-9]+$/u.test(sourceDateEpoch)) {
  throw new Error("Pass the Storefront output directory and a Unix SOURCE_DATE_EPOCH.");
}

const epochSeconds = Number(sourceDateEpoch);
const buildDate = new Date(epochSeconds * 1_000);

if (!Number.isSafeInteger(epochSeconds) || Number.isNaN(buildDate.getTime())) {
  throw new Error("SOURCE_DATE_EPOCH must be a safe Unix timestamp.");
}

const normalizedDate = buildDate.toISOString();
const buildInfoPath = resolve(outputDirectory, "nitro.json");
const buildInfo = JSON.parse(await readFile(buildInfoPath, "utf8"));

if (!buildInfo.serverEntry) {
  throw new Error("The Nitro build information does not name a server entry.");
}

const serverEntryPath = resolve(outputDirectory, buildInfo.serverEntry);
const serverSource = await readFile(serverEntryPath, "utf8");
const regionHeader = "//#region #nitro/virtual/public-assets-data\n";
const regionFooter = "\n//#endregion";
const regionStart = serverSource.indexOf(regionHeader);
const declarationStart = regionStart + regionHeader.length;
const regionEnd = serverSource.indexOf(regionFooter, declarationStart);

if (regionStart < 0 || regionEnd < 0) {
  throw new Error("The Nitro server entry does not contain public asset metadata.");
}

const declaration = serverSource.slice(declarationStart, regionEnd);
const assignment = declaration.indexOf(" = ");

if (!declaration.startsWith("var ") || assignment < 5 || !declaration.endsWith(";")) {
  throw new Error("The Nitro public asset declaration has an unsupported format.");
}

const variableName = declaration.slice(4, assignment);
const assets = JSON.parse(declaration.slice(assignment + 3, -1));
const normalizedAssets = Object.fromEntries(
  Object.entries(assets)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([assetPath, metadata]) => [assetPath, { ...metadata, mtime: normalizedDate }]),
);
const normalizedDeclaration = `var ${variableName} = ${JSON.stringify(normalizedAssets, null, "\t")};`;
const normalizedServerSource = `${serverSource.slice(0, declarationStart)}${normalizedDeclaration}${serverSource.slice(regionEnd)}`;

await Promise.all([
  writeFile(buildInfoPath, `${JSON.stringify({ ...buildInfo, date: normalizedDate }, null, 2)}\n`),
  writeFile(serverEntryPath, normalizedServerSource),
]);
