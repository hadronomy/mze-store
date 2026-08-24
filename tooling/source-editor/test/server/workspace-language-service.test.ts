import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

import { createWorkspaceLanguageService } from "~/server/workspace-language-service";

test("uses the nearest project configuration for each host document", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mze-source-project-"));
  const packageDirectory = join(directory, "package");
  const sourceDirectory = join(packageDirectory, "src");
  const hostFileName = join(packageDirectory, "fixture.test.ts");
  const valueFileName = join(sourceDirectory, "value.ts");
  const hostText = [
    'import { src } from "@mze-store/test";',
    'const fixture = src.ts`import { value } from "@fixture/value"; value;`;',
  ].join("\n");

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          module: "esnext",
          moduleResolution: "bundler",
          paths: { "@fixture/*": ["src/*"] },
          target: "esnext",
        },
        include: ["**/*.ts"],
      }),
    );
    await writeFile(valueFileName, "export const value = 1;\n");
    await writeFile(hostFileName, hostText);

    const service = createWorkspaceLanguageService({ directory, warn: () => undefined });
    service.updateDocument({ fileName: hostFileName, text: hostText, version: 1 });
    const use = hostText.lastIndexOf("value");

    expect(service.getDefinitions({ fileName: hostFileName, offset: use })).toEqual([
      expect.objectContaining({ fileName: valueFileName, start: "export const ".length }),
    ]);

    service.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reloads project files and configuration after workspace changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mze-source-reload-"));
  const packageDirectory = join(directory, "package");
  const sourceDirectory = join(packageDirectory, "src");
  const generatedDirectory = join(packageDirectory, "generated");
  const baseConfigFileName = join(packageDirectory, "tsconfig.base.json");
  const configFileName = join(packageDirectory, "tsconfig.json");
  const hostFileName = join(packageDirectory, "fixture.test.ts");
  const sourceValueFileName = join(sourceDirectory, "value.ts");
  const generatedValueFileName = join(generatedDirectory, "value.ts");
  const hostText = [
    'import { src } from "@mze-store/test";',
    'const fixture = src.ts`import { value } from "@fixture/value"; value;`;',
  ].join("\n");

  const projectConfig = (path: string) =>
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        module: "esnext",
        moduleResolution: "bundler",
        paths: { "@fixture/*": [path] },
        target: "esnext",
      },
    });

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(generatedDirectory, { recursive: true });
    await writeFile(baseConfigFileName, projectConfig("src/*"));
    await writeFile(
      configFileName,
      JSON.stringify({ extends: "./tsconfig.base.json", include: ["**/*.ts"] }),
    );
    await writeFile(sourceValueFileName, "export const value = 1;\n");
    await writeFile(generatedValueFileName, "\nexport const value = 2;\n");
    await writeFile(hostFileName, hostText);

    const service = createWorkspaceLanguageService({ directory, warn: () => undefined });
    service.updateDocument({ fileName: hostFileName, text: hostText, version: 1 });
    const use = hostText.lastIndexOf("value");
    expect(service.getDefinitions({ fileName: hostFileName, offset: use })).toEqual([
      expect.objectContaining({ fileName: sourceValueFileName }),
    ]);

    await writeFile(baseConfigFileName, projectConfig("generated/*"));
    service.reloadProjects([baseConfigFileName]);

    expect(service.getDefinitions({ fileName: hostFileName, offset: use })).toEqual([
      expect.objectContaining({
        fileName: generatedValueFileName,
        start: "\nexport const ".length,
      }),
    ]);

    await writeFile(baseConfigFileName, projectConfig("src/*"));
    service.reloadProjects([join(packageDirectory, "dist", "value.js")]);
    expect(service.getDefinitions({ fileName: hostFileName, offset: use })).toEqual([
      expect.objectContaining({ fileName: generatedValueFileName }),
    ]);

    service.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not reload an unrelated project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mze-source-selective-reload-"));
  const firstDirectory = join(directory, "first");
  const secondDirectory = join(directory, "second");
  const firstHost = join(firstDirectory, "fixture.test.ts");
  const secondHost = join(secondDirectory, "fixture.test.ts");
  const hostText = [
    'import { src } from "@mze-store/test";',
    "const fixture = src.ts`const value = 1;`;",
  ].join("\n");
  const warnings: string[] = [];

  try {
    await mkdir(firstDirectory, { recursive: true });
    await mkdir(secondDirectory, { recursive: true });
    await writeFile(join(firstDirectory, "tsconfig.json"), '{"include":["**/*.ts"]}');
    await writeFile(join(secondDirectory, "tsconfig.json"), '{"include":["**/*.ts"]}');
    await writeFile(firstHost, hostText);
    await writeFile(secondHost, hostText);

    const service = createWorkspaceLanguageService({
      directory,
      warn: (message) => warnings.push(message),
    });
    service.updateDocument({ fileName: firstHost, text: hostText, version: 1 });
    service.updateDocument({ fileName: secondHost, text: hostText, version: 1 });
    await writeFile(join(secondDirectory, "tsconfig.json"), "{");

    service.reloadProjects([join(firstDirectory, "dependency.ts")]);

    expect(warnings).toEqual([]);
    service.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
