# Source fixtures use explicit language tags

Tests contain JavaScript, TypeScript, JSONC, Bash, and SQL fixtures. Plain
template literals keep the test indented, but they also keep that indentation
in the fixture. Editors treat the body as a string, so they do not give the
fixture its language features.

A bare `src` tag cannot identify the fixture language. Guessing from the text
would make highlighting and editor behavior unstable.

TypeScript server plugins are also not a durable seam. TypeScript 7 runs its
language service in Go and cannot load the old JavaScript plugin form. The
replacement extension protocol is not ready. The evidence is in the
[editor support report](../research/src-template-editor-support.md).

## Decision

`@mze-store/test` exports one frozen `src` value with five members:

```ts
src.js`...`;
src.ts`...`;
src.jsonc`...`;
src.bash`...`;
src.sql`...`;
```

Each member returns a primitive string. It removes common indentation, aligns
multiline substitutions, reads cooked template text, and adds no final newline.
It does not parse, format, validate, or run the fixture. There is no callable
bare `src` tag.

The package emits ESM and CommonJS because Vitest and Medusa Jest both use it.
It has no editor dependency.

The private `mze-source-editor` extension owns editor behavior. A pure
scanner creates cooked virtual documents and maps their UTF-16 offsets back to
the host file. TextMate grammars provide syntax colors for all five languages.
A standalone Node language server provides JavaScript and TypeScript features.
It uses Volar virtual-code mappings and TypeScript 6. It does not use a
TypeScript server plugin.

Editor support requires the direct named import and member form shown above.
TextMate cannot resolve import aliases. SQL colors use VS Code's built-in SQL
grammar, as the other four languages use their built-in grammars.

Substitutions are opaque generated ranges. The language server rejects results
and edits that cross them because their runtime source is unknown.

Inactive literal ranges use opacity `0.72`. The range that contains the cursor
or selection stays at full opacity. High-contrast themes disable the effect.
VS Code has no stable text hover event, so pointer hover does not change it.

## Consequences

- A fixture needs one import and one language member. The result works anywhere
  that accepts a string.
- The language member gives TextMate and the scanner one exact language signal.
- JavaScript and TypeScript fixtures get diagnostics, completion, hover,
  navigation, rename, formatting, code actions, refactors, semantic tokens, and
  inlay hints on literal ranges. Parameter-name hints are on for literal
  arguments by default.
- JSONC, Bash, and SQL get syntax colors. Their richer language features need
  separate language Adapters.
- An escaped source character can use more host characters than virtual
  characters. The scanner owns that mapping in one place.
- Developers install one private VSIX with `bun run editor:install`. The VSIX
  contains the language server.

## Rejected alternatives

- Expose a bare `src` tag. It cannot select a language without guessing.
- Return a source document object. It adds conversion work to every string
  consumer.
- Export five top-level tags. That adds imports without improving the language
  signal.
- Use a TypeScript server plugin. It creates a known TypeScript 7 replacement
  task.
- Change editor workbench CSS or inspect its DOM. VS Code does not support that
  extension seam.
