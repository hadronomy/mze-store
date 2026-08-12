import type { Context as OxlintContext, ESTree } from "@oxlint/plugins";
import { Effect } from "effect";
import { expect, test } from "vite-plus/test";

import { Rule, Visitor } from "./effect-rule";

function fakeContext(): OxlintContext {
  const reports: unknown[] = [];

  return {
    get id() {
      return "hadronomy/sync";
    },
    get options() {
      return [];
    },
    get filename() {
      return "/repo/page.ts";
    },
    get physicalFilename() {
      return "/repo/page.ts";
    },
    get cwd() {
      return "/repo";
    },
    get sourceCode() {
      return {};
    },
    report(diagnostic) {
      reports.push(diagnostic);
    },
  } as OxlintContext;
}

test("onSync merges shared keys into one direct callback", () => {
  const calls: string[] = [];
  const rule = Rule.defineOnce({
    setup: Effect.succeed({
      visitors: {},
      syncVisitors: Visitor.merge(
        Visitor.onSync("ImportDeclaration", (_node, file) => {
          calls.push(`enter:${file.filename}`);
        }),
        Visitor.onSync("ImportDeclaration", () => {
          calls.push("second");
        }),
        Visitor.onSync("ImportDeclaration:exit", () => {
          calls.push("exit");
        }),
      ),
    }),
  });
  const visitor = rule.createOnce!(fakeContext());

  visitor.before?.();
  visitor.ImportDeclaration?.({} as ESTree.ImportDeclaration);
  visitor["ImportDeclaration:exit"]?.({} as ESTree.ImportDeclaration);
  visitor.after?.();

  expect(calls).toEqual(["enter:/repo/page.ts", "second", "exit"]);
});

test("onSync receives the same file frame for diagnostics and fixes", () => {
  const diagnostics: unknown[] = [];
  const context = {
    id: "hadronomy/sync",
    options: [],
    filename: "/repo/page.ts",
    physicalFilename: "/repo/page.ts",
    cwd: "/repo",
    sourceCode: {},
    report(diagnostic: unknown) {
      diagnostics.push(diagnostic);
    },
  } as OxlintContext;
  const rule = Rule.defineOnce({
    setup: Effect.succeed({
      visitors: {},
      syncVisitors: [
        Visitor.onSync("ImportDeclaration", (node, file) => {
          file.report({ node, message: "Use the alias" } as never);
        }),
      ],
    }),
  });
  const visitor = rule.createOnce!(context);

  visitor.before?.();
  visitor.ImportDeclaration?.({} as ESTree.ImportDeclaration);
  visitor.after?.();

  expect(diagnostics).toHaveLength(1);
});
