import { describe, expect, test } from "vite-plus/test";

import {
  mapSourceRange,
  mapVirtualRange,
  scanSourceBlocks,
  sourceOffsetToVirtual,
  virtualOffsetToSource,
} from "../../src/core/index.ts";

const sourceImport = 'import { src } from "@mze-store/test";\n';

describe("scanSourceBlocks", () => {
  test("finds a direct language-tagged template from the named import", () => {
    const text = `${sourceImport}const value = src.ts\`const answer: number = 42;\`;`;
    const [block] = scanSourceBlocks(text, "fixture.ts");

    expect(block).toMatchObject({
      language: "ts",
      virtualText: "const answer: number = 42;",
    });
    expect(block?.fullRange).toEqual({
      start: sourceImport.length + "const value = ".length,
      end: text.length - 1,
    });
    expect(block?.bodyRange).toEqual({
      start: sourceImport.length + "const value = src.ts`".length,
      end: text.length - 2,
    });
    expect(block?.literalRanges).toHaveLength(1);
    expect(block?.substitutionRanges).toHaveLength(0);
  });

  test("uses only the direct src import that the grammar can highlight", () => {
    const text = [
      'import { src as source } from "@mze-store/test";',
      "const first = source.js`const first = true;`;",
      "const { src: local } = helpers;",
      "const second = local.js`const second = true;`;",
    ].join("\n");

    const blocks = scanSourceBlocks(text, "fixture.js");

    expect(blocks).toEqual([]);
  });

  test("does not treat an unrelated import or namespace member as src", () => {
    const text = [
      'import { src as other } from "somewhere-else";',
      'import * as test from "@mze-store/test";',
      "other.ts`const wrong = true;`;",
      "test.src.ts`const alsoWrong = true;`;",
    ].join("\n");

    expect(scanSourceBlocks(text, "fixture.ts")).toEqual([]);
  });

  test.each(["fixture.js", "fixture.jsx", "fixture.ts", "fixture.tsx"])(
    "scans %s host files",
    (fileName) => {
      const text = `${sourceImport}const value = src.js\`value\`;`;

      expect(scanSourceBlocks(text, fileName)).toMatchObject([
        { language: "js", virtualText: "value" },
      ]);
    },
  );

  test("ignores type-only imports and unsupported host files", () => {
    const text = [
      'import type { src } from "@mze-store/test";',
      'import { type src as typed } from "@mze-store/test";',
      "src.ts`const ignored = true;`;",
    ].join("\n");

    expect(scanSourceBlocks(text, "fixture.ts")).toEqual([]);
    expect(scanSourceBlocks(text, "fixture.json")).toEqual([]);
  });

  test("cooks escapes, preserves literal substitutions, and maps both directions", () => {
    const text = `${sourceImport}src.js\`const newline = "\\n"; \\\${value} \\\` done\`;`;
    const [block] = scanSourceBlocks(text, "fixture.ts");

    expect(block?.virtualText).toBe('const newline = "\n"; ${value} ` done');
    expect(block?.literalRanges.length).toBeGreaterThan(1);
    expect(block?.substitutionRanges).toHaveLength(0);

    const cookedStart = block?.virtualText.indexOf("${value}");
    const sourceStart = text.indexOf("\\${value}");
    expect(cookedStart).toBeGreaterThanOrEqual(0);
    expect(sourceStart).toBeGreaterThanOrEqual(0);
    expect(virtualOffsetToSource(block!, cookedStart!)).toBe(sourceStart);
    expect(sourceOffsetToVirtual(block!, sourceStart + 1)).toBe(cookedStart);
  });

  test("replaces substitutions with opaque virtual regions and keeps line structure", () => {
    const text = `${sourceImport}src.ts\`const result = \${value};\n\${next}\`;`;
    const [block] = scanSourceBlocks(text, "fixture.ts");

    expect(block?.substitutionRanges).toHaveLength(2);
    expect(block?.virtualText).toMatch(
      /^const result = __mze_source_substitution_0__;\n__mze_source_substitution_1__$/,
    );

    const first = block?.substitutionRanges[0];
    expect(first && text.slice(first.source.start, first.source.end)).toBe("${value}");
    expect(first && block?.virtualText.slice(first.virtual.start, first.virtual.end)).toBe(
      "__mze_source_substitution_0__",
    );
  });

  test("scans multiple blocks and supports JSONC, Bash, and SQL tags", () => {
    const text = [
      sourceImport.trimEnd(),
      'const config = src.jsonc`{ \\"enabled\\": true }`;',
      "const script = src.bash`set -euo pipefail`;",
      "const query = src.sql`select 1;`;",
    ].join("\n");

    expect(scanSourceBlocks(text, "fixture.ts").map((block) => block.language)).toEqual([
      "jsonc",
      "bash",
      "sql",
    ]);
  });

  test("keeps the best available block for incomplete templates", () => {
    const text = `${sourceImport}src.ts\`const answer: number = 42`;
    const [block] = scanSourceBlocks(text, "fixture.ts");

    expect(block?.virtualText).toBe("const answer: number = 42");
    expect(block?.fullRange.end).toBe(text.length);
  });

  test("maps a cooked line continuation to its single virtual position", () => {
    const text = `${sourceImport}src.ts\`value ` + "\\\n" + "`;";
    const [block] = scanSourceBlocks(text, "fixture.ts");

    expect(block?.virtualText).toBe("value ");
    expect(mapSourceRange(block!, block!.bodyRange)).toEqual({
      start: 0,
      end: block!.virtualText.length,
    });
  });

  test("maps ranges across cooked literals and substitutions", () => {
    const text = `${sourceImport}src.ts\`const value = \${answer};\``;
    const [block] = scanSourceBlocks(text, "fixture.ts");
    const sourceRange = block?.bodyRange;

    expect(sourceRange).toBeDefined();
    expect(mapSourceRange(block!, sourceRange!)).toEqual({
      start: 0,
      end: block?.virtualText.length,
    });
    expect(mapVirtualRange(block!, { start: 0, end: block!.virtualText.length })).toEqual(
      sourceRange,
    );
  });
});
