import { describe, expect, test } from "vite-plus/test";

import { createSourceLanguageService, type SourceDocument } from "~/server/language-service";

const fileName = "/workspace/fixture.test.ts";

function document(text: string): SourceDocument {
  return { fileName, text };
}

function createService(text: string) {
  return createSourceLanguageService({ documents: [document(text)] });
}

function offsetOf(text: string, value: string, occurrence = 0): number {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    offset = text.indexOf(value, offset + 1);
  }

  if (offset === -1) {
    throw new Error(`Could not find ${JSON.stringify(value)}`);
  }

  return offset;
}

describe("SourceLanguageService", () => {
  test("maps diagnostics from a TypeScript block to its host range", () => {
    const text =
      'import { src } from "@mze-store/test";\n' +
      'const result = src.ts`const value: number = "wrong";`;';
    const service = createService(text);

    const diagnostics = service.getDiagnostics(fileName);

    expect(diagnostics.some((item) => item.message.includes("string"))).toBe(true);
    expect(diagnostics.every((item) => item.fileName === fileName)).toBe(true);
    expect(diagnostics.every((item) => item.start >= text.indexOf("src.ts`"))).toBe(true);

    service.dispose();
  });

  test("provides completion and hover from a JavaScript block", () => {
    const text =
      'import { src } from "@mze-store/test";\n' +
      "const result = src.js`const answer = { toFixed: 1 }; answer.toF`;";
    const service = createService(text);
    const prefixStart = offsetOf(text, "toF", 1);
    const hostPosition = prefixStart + "toF".length;
    const completion = service.getCompletions({ fileName, offset: hostPosition });
    const hover = service.getHover({
      fileName,
      offset: offsetOf(text, "answer", 1),
    });
    expect(completion?.items).toContainEqual(
      expect.objectContaining({
        entry: expect.objectContaining({ name: "toFixed" }),
        replacementSpan: { fileName, start: prefixStart, length: "toF".length },
      }),
    );
    expect(hover?.info.displayParts?.map((part) => part.text).join("")).toContain("answer");
    expect(hover?.range.fileName).toBe(fileName);

    service.dispose();
  });

  test("maps definitions, references, and rename locations", () => {
    const text =
      'import { src } from "@mze-store/test";\n' +
      "const result = src.ts`const value = 1; value + value`;";
    const service = createService(text);
    const use = offsetOf(text, "value", 2);

    const definitions = service.getDefinitions({ fileName, offset: use });
    const references = service.getReferences({ fileName, offset: use });
    const rename = service.getRename({ fileName, offset: use }, "answer");

    expect(definitions?.some((item) => item.fileName === fileName)).toBe(true);
    expect(references?.every((item) => item.fileName === fileName)).toBe(true);
    expect(rename.info.canRename).toBe(true);
    expect(rename.locations).toHaveLength(3);
    expect(rename.locations.every((item) => item.fileName === fileName)).toBe(true);

    service.dispose();
  });

  test("resolves relative imports from the host directory", () => {
    const text =
      'import { src } from "@mze-store/test";\n' +
      'const result = src.ts`import { value } from "./value.js"; value;`;';
    const dependency = {
      fileName: "/workspace/value.ts",
      text: "export const value = 1;",
    };
    const service = createSourceLanguageService({
      documents: [document(text)],
      projectFiles: [dependency],
      currentDirectory: "/workspace",
    });
    const use = offsetOf(text, "value", 2);

    expect(service.getDefinitions({ fileName, offset: use })).toEqual([
      expect.objectContaining({
        fileName: dependency.fileName,
        start: dependency.text.indexOf("value"),
      }),
    ]);

    service.dispose();
  });

  test("rejects edits that cross an interpolation", () => {
    const text =
      'import { src } from "@mze-store/test";\n' +
      "const result = src.ts`const value = ${external};`;";
    const service = createService(text);

    const formatting = service.getFormatting(fileName);
    const diagnostics = service.getDiagnostics(fileName);

    expect(formatting).toEqual([]);
    expect(diagnostics.every((item) => !item.message.includes("Cannot find name 'external'"))).toBe(
      true,
    );

    service.dispose();
  });

  test("keeps multiple blocks in separate virtual files", () => {
    const text = [
      'import { src } from "@mze-store/test";',
      'const first = src.ts`const broken: number = "no";`;',
      "const second = src.ts`const ready: number = 1;`;",
    ].join("\n");
    const service = createService(text);

    const diagnostics = service.getDiagnostics(fileName);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((item) => item.start < text.indexOf("const second"))).toBe(true);

    service.dispose();
  });

  test("maps formatting edits and quick fixes to the host document", () => {
    const text =
      'import { src } from "@mze-store/test";\n' +
      "const result = src.ts`const value={ count:Math.rond(2) };`;";
    const service = createService(text);
    const diagnostics = service.getDiagnostics(fileName);
    const typo = diagnostics.find((item) => item.diagnostic.code === 2551);
    expect(typo).toBeDefined();
    const actions = service.getCodeActions(
      { fileName, start: typo!.start, end: typo!.start + typo!.length },
      diagnostics.map((item) => item.diagnostic.code),
    );

    expect(service.getFormatting(fileName).length).toBeGreaterThan(0);
    expect(
      actions.flatMap((action) => action.changes).some((change) => change.newText === "round"),
    ).toBe(true);
    expect(
      actions.flatMap((action) => action.changes).every((change) => change.fileName === fileName),
    ).toBe(true);

    service.dispose();
  });

  test("provides mapped refactors, semantic classifications, and inlay hints", () => {
    const text =
      'import { src } from "@mze-store/test";\n' +
      "const result = src.ts`function add(left: number, right: number) { return left + right; }\nadd(1, 2);`;";
    const service = createService(text);
    const expressionStart = offsetOf(text, "left + right");
    const expressionEnd = expressionStart + "left + right".length;
    const range = { fileName, start: expressionStart, end: expressionEnd };
    const documentRange = { fileName, start: 0, end: text.length };

    expect(service.getApplicableRefactors(range).length).toBeGreaterThan(0);
    expect(service.getSemanticClassifications(documentRange)?.spans.length).toBeGreaterThan(0);
    expect(service.getInlayHints(documentRange, { includeInlayParameterNameHints: "all" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ position: expect.objectContaining({ fileName }) }),
      ]),
    );

    service.dispose();
  });
});
