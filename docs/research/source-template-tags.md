# Source-like template tags for test fixtures

Checked 2026-08-22. This note covers the `src` helper seen in an X post and its fit for MZE Store tests.

## Result

No mainstream test framework or package reviewed here exports a helper literally named `src`. The strongest name match is a local alias:

```ts
import { source as src } from "common-tags";
```

`common-tags` exports `source` and `codeBlock` as aliases of its `html` tag. Confidence is medium-high that the observed name was a local alias, and medium that `common-tags` was the package. The exact X post remains unidentified because X search required sign-in, and no author or link was supplied.

The strongest observed usage pattern is `dedent`, while `common-tags` is the
strongest name match. MZE uses `ts-dedent@2.3.0` behind explicit `src.*`
language tags.

## Evidence

The [common-tags README](https://github.com/zspecza/common-tags/blob/d3f704255f636641e80cefece3ca1c16eb773e71/readme.md#L342-L367) documents the `source` and `codeBlock` aliases. Its [exports](https://github.com/zspecza/common-tags/blob/d3f704255f636641e80cefece3ca1c16eb773e71/src/index.js#L281-L313) and [HTML pipeline](https://github.com/zspecza/common-tags/blob/d3f704255f636641e80cefece3ca1c16eb773e71/src/html/html.js#L222-L243) show that `source` is not source-specific. It splits multiline substitutions, removes nullish and other non-printing substitutions, expands arrays, aligns their lines, and strips common indentation. It does not parse JavaScript, SQL, or Bash. Version 1.8.2 was published on 2021-11-16. It has no built-in types or `exports` map; [`@types/common-tags`](https://registry.npmjs.org/@types/common-tags/latest) is separate.

A public local example supports the alias explanation. The [slashdown syntax test](https://github.com/nickisnoble/slashdown/blob/87db90dba1719e0854d2f34aa870d2356bc97257/test/syntax.test.ts) defines `function src(...)` and passes it through a local `dedent` helper.

Identity tags are a separate possibility. [code-tag](https://github.com/fregante/code-tag) exports `any`, which can be renamed to `src`. Its [implementation](https://github.com/fregante/code-tag/blob/main/index.ts#L240-L279) returns the normal cooked template result. [fake-tag](https://github.com/jaydenseric/fake-tag) does the same. Neither removes indentation, so neither solves the main MZE need.

Primary usage examples show semantic aliases: [Jest](https://github.com/jestjs/jest/blob/52db46e50404c993d3f10dd1481e861cc04ae22e/packages/jest-circus/src/utils.ts#L239-L245) and [Node userland migrations](https://github.com/nodejs/userland-migrations/blob/b7215844155844d61d9d27398d45013ef0411148/utils/src/ast-grep/shebang.test.ts#L3-L12) use `dedent`; [Babel](https://github.com/babel/babel/blob/1da3cfa1a25503c7ecba7304f8738933e6d16dca/eslint/babel-eslint-tests/test/index.js#L2) aliases it to `unpad`; [Tailwind CSS IntelliSense](https://github.com/tailwindlabs/tailwindcss-intellisense/blob/5067ff7ec0b4b8bb5c3325a69c1f3410eb5b350a/packages/tailwindcss-language-server/src/testing/index.ts#L166-L170) re-exports it as `css`, `html`, and `js`.

## MZE audit

The audit found 10 test files with embedded source:

- Package probes: [auth](../../packages/auth/test/package-exports.test.ts#L28) has 3 ESM snippets; [db](../../packages/db/test/package-exports.test.ts#L19) has 3; [territory](../../packages/territory/test/package-exports.test.ts#L19) has 4 ESM/CommonJS snippets.
- Oxlint fixtures: [index](../../tooling/oxlint/test/index.test.ts#L24) has JSONC, TypeScript, and expected transformed source; [baseline](../../tooling/oxlint/test/baseline.test.ts#L76) writes TypeScript strings.
- Process fixtures: [child-command](../../tooling/mze/src/child-command.test.ts#L27) has inline Node and assembled child scripts; [cli.live](../../tooling/mze/src/cli.live.test.ts#L215) has shell fixtures and nested Node.
- CI fixtures: [normalize-storefront-output](../../tooling/ci/normalize-storefront-output.test.ts#L13) has generated JavaScript; [image-policy](../../tooling/ci/image-policy.test.ts#L141) has Bash with interpolated digests.
- Medusa: [auth-schema](../../apps/medusa/integration-tests/http/auth-schema.spec.ts#L31) has SQL.

## Candidate table

Facts were checked on 2026-08-22.

| Candidate                                                                      | Maintenance and packaging                                                     | Behavior and fit                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `common-tags@1.8.2` ([registry](https://registry.npmjs.org/common-tags/1.8.2)) | Last release 2021-11-16. No built-in types or `exports`.                      | Strong name match. Rich HTML pipeline.                                  |
| `ts-dedent@2.3.0` ([registry](https://registry.npmjs.org/ts-dedent/2.3.0))     | Published 2026-06-10. Built-in types, conditional `exports`, no dependencies. | Dedents cooked templates and aligns multiline interpolations. Best fit. |
| `dedent@1.7.2` ([registry](https://registry.npmjs.org/dedent/1.7.2))           | Published 2026-03-01. Types and `exports`. No dependencies.                   | Reads `strings.raw` and unescapes. Reject under defaults.               |
| `outdent@0.8.0` ([registry](https://registry.npmjs.org/outdent/0.8.0))         | Last release 2020-12-16. Has `typings`, no `exports`.                         | Dedents, but default interpolation does not align every inserted line.  |
| `codedent@0.1.3` ([registry](https://registry.npmjs.org/codedent/0.1.3))       | Published 2026-06-22. 11 GitHub stars, no types, one `plain-tag` dependency.  | Code-specific dedent. Less attractive for types and adoption.           |
| Local helper                                                                   | Repository-owned types and behavior.                                          | Good only if MZE wants to own the contract.                             |

## Focused experiment

With Node 24.18.1 and the exact candidate versions, I tested:

```ts
const text = "\\n";
const pattern = /\\d+/u;
```

`common-tags source`, `common-tags stripIndent`, `outdent`, and `ts-dedent` preserved the escaped source. Default `dedent` changed the string and regular-expression source because it unescaped raw text.

For a multiline interpolation, `common-tags source` and `ts-dedent` aligned every inserted line. `common-tags stripIndent`, `outdent`, and default `dedent` did not under defaults. This was a focused local test, not a benchmark.

## Decision

Use `ts-dedent@2.3.0` behind `@mze-store/test`. Its
[source](https://github.com/tamino-martinius/node-ts-dedent/blob/master/src/index.ts)
uses cooked template entries, removes common indentation and outer blank
lines, and aligns multiline values. Its
[release](https://github.com/tamino-martinius/node-ts-dedent/releases/tag/v2.3.0)
tests packaged CommonJS, ESM, and types on Node 22, 24, and 26 across Linux,
macOS, and Windows.

```ts
import { src } from "@mze-store/test";

const code = src.js`
  import { value } from "./module.js";

  console.log(value);
`;
```

The member name supplies the language signal that syntax grammars and virtual
documents need. A bare `src` tag is not available. Ordinary cooked-template
rules still require escaping embedded backticks and literal `${` markers.
Append `"\n"` when a fixture requires a final newline. Use `String.raw` only
when a test intentionally inspects raw or malformed escapes. See the
[typescript-eslint `noFormat` tag](https://github.com/typescript-eslint/typescript-eslint/blob/56c9ed90d0aee0b5a71cfc39fc76b715b82e3ea8/packages/rule-tester/src/noFormat.ts#L1-L6)
for that separate identity-tag pattern.

The first migration covers package probes, Oxlint JSONC, process JavaScript,
CI JavaScript and Bash, and the Medusa SQL query. One-line commands and exact
output strings stay unchanged.

## Requirements and limitations

The helper must preserve nested indentation and blank lines, align interpolations, allow nested template syntax, keep a shebang at byte zero, work in Vitest and Jest, perform no formatting, and remain a direct dependency.

The [TC39 String.dedent proposal](https://github.com/tc39/proposal-string-dedent) is Stage 2 on 2026-08-22 and names embedded source as a use case. It is not available in Node 24.18.1. The X post is still unidentified. The experiment covers only representative JavaScript and interpolation cases.
