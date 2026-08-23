# Editor support for `src` tagged templates

Checked 2026-08-23.

## Result

Use two editor seams:

1. A private VS Code extension under `tooling/` for TextMate highlighting and inactive-range styling.
2. An auxiliary language server with a Volar virtual-code layer for diagnostics, completion, hover, definitions, references, rename, formatting, refactors, semantic tokens, and inlay hints.

Keep `@mze-store/test` independent. It remains a runtime package and must not import editor APIs.

A TextMate grammar alone cannot provide full language features. A TypeScript server plugin can provide them on TypeScript 6, but TypeScript 7 does not load these JavaScript plugins. The auxiliary language-server boundary avoids coupling the design to that obsolete extension point.

The feature also needs an explicit language signal. Keep one `src` import, but expose language-specific tags:

```ts
const javascript = src.js`console.log("ready");`;
const typescript = src.ts`const value: number = 1;`;
const config = src.jsonc`{ "rules": {} }`;
const script = src.bash`set -euo pipefail`;
const query = src.sql`select 1;`;
```

Do not expose a bare `src` tag. It makes correct highlighting and language-service selection ambiguous.

## TextMate injection grammar

VS Code uses TextMate grammars for syntax highlighting. An injection grammar contributes `injectTo` scopes and an `injectionSelector`. For MZE, the grammar can target `source.ts` and `source.js`, match a `src` tag followed by a template literal, and assign an embedded TypeScript or JavaScript scope. The `embeddedLanguages` map can then enable basic bracket matching and snippet selection inside the embedded range. See the [Syntax Highlight Guide](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide) and [Embedded Languages guide](https://code.visualstudio.com/api/language-extensions/embedded-languages).

The grammar can color the template body. It cannot parse the body as a project file or call a language service. VS Code separates declarative syntax features from programmatic features such as diagnostics, IntelliSense, hover, and go to definition. See the [language extensions overview](https://code.visualstudio.com/api/language-extensions/overview).

Match `src.js`, `src.ts`, `src.jsonc`, `src.bash`, and `src.sql` in separate rules. Give each body a `meta.embedded.*` scope and map that scope to its VS Code language ID. Include the host TypeScript template-substitution rule before the embedded grammar so `${...}` expressions stay in host TypeScript mode. Lit uses this structure in its [injection grammar](https://github.com/runem/lit-analyzer/blob/master/packages/vscode-lit-plugin/syntaxes/vscode-lit-html/lit-html.json).

TextMate is a regular-expression grammar. It cannot resolve imports or aliases. Editor support therefore uses the direct `import { src }` and `src.<language>` form. It also cannot perfectly model arbitrary escaped backticks in source that is itself inside a template literal. Tests must cover escaped backticks, `${...}` substitutions, incomplete input, JS, TS, JSX, and TSX host files. VS Code supplies built-in grammars for JavaScript, TypeScript, JSONC, shell scripts, and SQL.

| Feature                    | Injection grammar    | Language service or LSP             |
| -------------------------- | -------------------- | ----------------------------------- |
| Inline syntax highlighting | Yes                  | Optional                            |
| Diagnostics                | No                   | Yes                                 |
| Completion and hover       | No                   | Yes                                 |
| Definitions and references | No                   | Yes                                 |
| Rename                     | No                   | Yes, with source mappings           |
| Formatting                 | No                   | Yes                                 |
| Semantic tokens            | TextMate tokens only | Yes, with a semantic-token provider |

The [TypeScript `LanguageService` interface](https://github.com/microsoft/TypeScript/blob/main/src/services/types.ts) exposes separate methods for diagnostics, completions, definitions, references, rename, formatting, and encoded semantic classifications. A grammar does not implement those methods.

## TypeScript language-service plugins

TypeScript plugins change the editor experience only. They do not load during `tsc` type checking or emit. Editors enable them through `compilerOptions.plugins` in `tsconfig.json` or `jsconfig.json`. See the [TypeScript plugin guide](https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin).

### `typescript-template-language-service-decorator`

The Microsoft decorator is a framework, not a ready-made TypeScript or JavaScript service. It finds tagged templates, replaces substitutions with same-length placeholders, calls a `TemplateLanguageService`, and translates offsets back to the source file. Its [settings](https://github.com/microsoft/typescript-template-language-service-decorator/blob/main/src/template-settings.ts), [context](https://github.com/microsoft/typescript-template-language-service-decorator/blob/main/src/template-context.ts), and [source helper](https://github.com/microsoft/typescript-template-language-service-decorator/blob/main/src/standard-template-source-helper.ts) define this seam.

Its [service interface](https://github.com/microsoft/typescript-template-language-service-decorator/blob/main/src/template-language-service.ts) and [proxy](https://github.com/microsoft/typescript-template-language-service-decorator/blob/main/src/template-language-service-decorator.ts) adapt these methods:

- completion and completion details
- quick info, which supplies hover text
- syntactic and semantic diagnostics
- formatting edits
- supported code fixes and code fixes at a position
- definitions and definition-plus-bound-span
- signature help
- folding ranges
- references
- JSX closing tags

The interface does not adapt `getRenameInfo`, `findRenameLocations`, `getEncodedSemanticClassifications`, or `getEncodedSyntacticClassifications`. It also omits several other TypeScript service methods, such as document symbols and document highlights. A plugin that needs those features must add its own wrappers or use another architecture.

The repository is [archived](https://github.com/microsoft/typescript-template-language-service-decorator) as of 2026-03-28. Treat it as a design reference or fork it and test it against the workspace TypeScript versions. Do not add it as an unreviewed long-term dependency.

### Lit and styled examples

The [Microsoft lit plugin](https://github.com/microsoft/typescript-lit-html-plugin) demonstrates completions, quick info, formatting, folding, semantic diagnostics, code fixes, references, and closing-tag insertion. Its source shows the corresponding [template service methods](https://github.com/microsoft/typescript-lit-html-plugin/blob/main/src/html-template-language-service.ts). It omits definitions, rename, and semantic tokens. Its signature-help method returns no result for HTML. The repository now warns that it is deprecated and does not work with TypeScript 7 or later.

The [Microsoft styled plugin](https://github.com/microsoft/typescript-styled-plugin) demonstrates CSS and SCSS completions, quick info, diagnostics, code fixes, and folding. Its [language service](https://github.com/microsoft/typescript-styled-plugin/blob/main/src/_language-service.ts) has no definition, reference, rename, formatting, or semantic-token implementation. Microsoft archived it in 2023. The [styled-components fork](https://github.com/styled-components/typescript-styled-plugin) is a current packaging option for CSS only. Neither plugin supplies a general `src` service.

For MZE, a custom service must parse each selected `src.js` or `src.ts` body as a separate virtual file. The decorator supplies tag selection and offset translation. It does not supply TypeScript semantics for the body.

### TypeScript 7 limit

Do not make a TypeScript server plugin the long-term seam. TypeScript 7 runs its language service in Go and cannot load third-party JavaScript into that process. The TypeScript team is designing an IPC API to replace plugin use cases, but the work remains open and is scheduled after TypeScript 7.0. See the official [extensibility design issue](https://github.com/microsoft/typescript-go/issues/2824) and [API direction](https://github.com/microsoft/typescript-go/discussions/455).

This repository still uses TypeScript 6 outside `tooling/mze`, so a server plugin can work today. It would be an interim path that the repository must replace. The repository guide rejects that type of stopgap.

## Volar and virtual code

Volar separates source code from generated virtual code. Its [language-core types](https://github.com/volarjs/volar.js/blob/master/packages/language-core/lib/types.ts) define virtual code, embedded code, and source-to-generated mappings. `CodeInformation` enables verification, completion, semantic, navigation, structure, and formatting features for each mapping. Its [editor helpers](https://github.com/volarjs/volar.js/blob/master/packages/language-core/lib/editor.ts) include diagnostics, completion, hover, semantic tokens, definitions, references, rename, symbols, folding, and formatting checks.

The [Volar language service](https://github.com/volarjs/volar.js/blob/master/packages/language-service/lib/languageService.ts) registers providers for diagnostics, completion, hover, definitions, references, rename, formatting, and semantic tokens. Its [source-map package](https://github.com/volarjs/volar.js/blob/master/packages/source-map/README.md) maps ranges and locations in both directions. The [Volar repository](https://github.com/volarjs/volar.js) documents its language-core, language-service, language-server, and VS Code-client layers.

Volar can support `src.js` and `src.ts` if MZE supplies a language plugin that recognizes each tag and generates one virtual JavaScript or TypeScript file per block. The standalone language-server path can use extra service scripts, so separate blocks do not share declarations or collide with the host test file. This is a larger implementation than a TypeScript plugin. It is the better fit because rename, semantic tokens, refactors, and inlay hints are requirements. VS Code's [embedded-language guidance](https://code.visualstudio.com/api/language-extensions/embedded-languages) also warns that cross-region formatting and renaming need special handling, and that TypeScript language services are stateful.

Each virtual file must:

- use the language and `ScriptKind` selected by the tag;
- resolve imports relative to the host test file;
- inherit the host project's compiler options, libraries, and module resolution;
- map cooked template text back to the host source, including escape sequences;
- treat `${...}` substitutions as opaque generated segments;
- disable diagnostics and edits in generated segments;
- map every edit and location back before it reaches the editor.

"All language features" means all features on literal template segments. Arbitrary interpolation values can insert tokens or whole statements only at runtime, so no editor can analyze their final source statically. Diagnostics that cross an interpolation hole need filtering.

## Inactive styling in VS Code

Theme settings and runtime decorations solve different problems:

- [`editor.tokenColorCustomizations`](https://code.visualstudio.com/docs/configure/themes) accepts TextMate scope rules. Those rules are static theme settings. They cannot dim only the `src` body that is inactive at the current cursor.
- [`ThemeColor`](https://code.visualstudio.com/api/references/theme-color) names a registered editor color. It does not add a dynamic TextMate scope or a cursor-aware token rule.
- [`DecorationRenderOptions`](https://code.visualstudio.com/api/references/vscode-api#DecorationRenderOptions) includes `opacity`, `color`, and background properties. An extension can create a decoration type and apply it to ranges with `setDecorations`.
- The public API exposes [`onDidChangeActiveTextEditor` and `onDidChangeTextEditorSelection`](https://code.visualstudio.com/api/references/vscode-api). It has no public editor hover-enter or hover-leave event. The [public API declaration](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts) is the source for this event surface.

Practical design:

1. Find `src.*` template-body ranges from the TypeScript AST or the virtual-code scanner.
2. Apply one low-opacity decoration, starting at `opacity: "0.72"`, to inactive body ranges.
3. On active-editor and selection changes, remove the decoration from the body that contains the cursor or selection.
4. Disable fading in high-contrast themes. Test diagnostics and selections with light and dark themes.

The extension can set `hoverMessage` on a decoration, but it cannot use pointer hover to switch the range between active and inactive styles. The stable API has a hover provider request but no hover-enter or hover-leave event. Cursor and selection state is the reliable trigger. Do not use a workbench DOM or custom-style-sheet hack; VS Code does not support either approach for extensions.

The current [`vscode-tagged-templates`](https://github.com/mike-north/vscode-tagged-templates) extension is a useful visual reference. It finds tagged-template ranges with the TypeScript AST and adds theme-aware background and border decorations. It does not remove those decorations for the active range, provide language features, or support pointer-hover state. Use its range tests as a reference, not the extension as the MZE implementation.

## Language identification

The tag name identifies a template occurrence. A bare `src` does not identify whether the body is TypeScript, JavaScript, JSONC, Bash, or SQL. The decorator's [template settings](https://github.com/microsoft/typescript-template-language-service-decorator/blob/main/src/template-settings.ts) contain tag names and substitution handling, but no payload-language field. VS Code's `embeddedLanguages` mapping also needs an explicit language scope.

Use `src.js`, `src.ts`, `src.jsonc`, `src.bash`, and `src.sql`. Do not guess the language from the body. Member tags keep one import, make editor recognition simple, and let TypeScript autocomplete the available languages.

## Packaging seam and compatibility

Place the grammar, decorations, language-server client, and editor settings in one private extension under `tooling/`. Place the Volar language server in a separate workspace package under the same editor boundary. Keep both packages independent of `@mze-store/test`.

The extension owns editor state. The auxiliary language server owns virtual files, project analysis, and language-service requests. The runtime helper only owns string construction.

No primary source reviewed here proves that T3 Code loads VS Code extensions or TypeScript plugins. T3 Code compatibility is unknown.

## Phased recommendation

| Phase | Work                                                                        | Effort              | Main risk                                                      |
| ----- | --------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------- |
| 1     | Change the helper design to explicit `src.*` language tags                  | Low                 | Naming and fixture classification                              |
| 2     | Private extension with injection grammars and cursor-aware inactive opacity | Medium              | Grammar edge cases and theme contrast                          |
| 3     | Volar prototype for one `src.ts` block with the full feature matrix         | High                | Cooked-text mappings, substitutions, and project state         |
| 4     | Extend the same virtual-code path to `src.js` and multiple blocks           | Medium to high      | Cross-file edits and virtual-file isolation                    |
| 5     | Add JSONC, Bash, and SQL services one at a time                             | Medium per language | Each language needs its own maintained service and edit mapper |

Start with the runtime tag shape and the extension grammar. Then build a narrow Volar prototype before broad test migration. The prototype must pass diagnostics, completion, hover, definition, references, rename, formatting, code actions, refactors, semantic tokens, and inlay hints before the repository calls the feature complete. Use the decorator and lit/styled repositories as implementation references, not as dependencies.
