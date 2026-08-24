import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vite-plus/test";

type IncludePattern = {
  readonly include: string;
};

type GrammarPattern = {
  readonly begin: string;
  readonly contentName: string;
  readonly end: string;
  readonly patterns: readonly IncludePattern[];
};

type Grammar = {
  readonly injectionSelector: string;
  readonly patterns: readonly IncludePattern[];
  readonly repository: Readonly<Record<string, GrammarPattern>>;
  readonly scopeName: string;
};

const languages = [
  { embedded: "source.js", name: "js" },
  { embedded: "source.ts", name: "ts" },
  { embedded: "source.json.comments", name: "jsonc" },
  { embedded: "source.shell", name: "bash" },
  { embedded: "source.sql", name: "sql" },
] as const;

const readGrammar = async (name: string): Promise<Grammar> =>
  JSON.parse(
    await readFile(new URL(`../../syntaxes/src-${name}.json`, import.meta.url), "utf8"),
  ) as Grammar;

const getPattern = (grammar: Grammar, name: string): GrammarPattern => {
  const pattern = grammar.repository[name];
  if (!pattern) throw new Error(`Grammar is missing ${name}`);
  return pattern;
};

describe("src template grammars", () => {
  for (const language of languages) {
    test(`embeds ${language.name} source in every TypeScript and JavaScript host`, async () => {
      const grammar = await readGrammar(language.name);
      const sourceBlock = getPattern(grammar, "source-block");

      expect(grammar.scopeName).toBe(`source.mze.src.${language.name}`);
      expect(grammar.patterns).toEqual([{ include: "#source-block" }]);
      expect(grammar.injectionSelector).toContain("L:source.js -comment");
      expect(grammar.injectionSelector).toContain("L:source.js.jsx -comment");
      expect(grammar.injectionSelector).toContain("L:source.ts -comment");
      expect(grammar.injectionSelector).toContain("L:source.tsx -comment");

      expect(sourceBlock.begin).toContain(`(${language.name})`);
      expect(sourceBlock.contentName).toBe(`meta.embedded.block.mze.src.${language.name}`);
      expect(sourceBlock.end).toBe("(?<!\\\\)(?:\\\\\\\\)*\\K`");
      const closingDelimiter = new RegExp(`${sourceBlock.end.replace("\\K", "")}$`, "u");
      expect(closingDelimiter.test("value`")).toBe(true);
      expect(closingDelimiter.test("value\\`")).toBe(false);
      expect(closingDelimiter.test("value\\\\`")).toBe(true);
      expect(sourceBlock.patterns).toEqual([
        { include: "source.ts#template-substitution-element" },
        { include: language.embedded },
      ]);
    });
  }
});
