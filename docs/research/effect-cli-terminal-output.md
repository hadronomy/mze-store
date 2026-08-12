# Terminal output for the Effect v4 CLI

**Date checked:** 2026-08-11

**Scope:** Human output, terminal interaction, and progress output for `bun run mze`

## Result

Add `chalk@6.0.0` for colored human text. Keep the repository `Output`
service as the only writer for command events.

Chalk formats strings and has no output side effects. It detects color support
for standard output and standard error separately. It also has no runtime
dependencies. These properties fit the existing output boundary.
[Chalk 6 package](https://registry.npmjs.org/chalk/6.0.0),
[Chalk 6 documentation](https://github.com/chalk/chalk/blob/661317e6f91fe7c90306c2c48ea9354562ee9146/readme.md)

Do not add a spinner, task-list renderer, prompt library, or cursor-control
library in the first pass. The current command design needs concise output,
correct stream routing, and clean NDJSON. It does not need a live terminal UI.

Keep these Effect v4 surfaces:

- `effect/unstable/cli` for parsing, help, and explicit interactive prompts.
- `Stdio` for output sinks and terminal checks.
- `Terminal` for input and prompt display.
- `Logger` for internal diagnostics, not command lifecycle events.
- The repository `Output` service for human and NDJSON command events.

The repository pins `effect` and `@effect/platform-node` to
`4.0.0-beta.107`. This report evaluates that cohort, not Effect v3.
[`effect` package](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/package.json),
[`@effect/platform-node` package](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node/package.json)

## First implementation pass

1. Add the exact dependency `chalk@6.0.0`.
2. Apply styles only inside the human branch of [`output.ts`](../../tooling/mze/output.ts).
3. Select `chalk` for standard output and `chalkStderr` for standard error.
4. Keep NDJSON free of ANSI codes and terminal symbols.
5. Use color for status and emphasis. Keep the complete message useful without color.
6. Make the color policy injectable in output tests.
7. Add no animated progress output.

Chalk 6 is ESM-only and requires Node 22 or newer. The repository is ESM and
pins Node 24.18.1, so both requirements fit. Chalk supports basic colors,
256 colors, and truecolor. User flags and `FORCE_COLOR` can override automatic
detection. `chalkStderr` uses a separate standard-error check.
[Chalk export and engine metadata](https://registry.npmjs.org/chalk/6.0.0),
[Chalk color detection](https://github.com/chalk/chalk/blob/661317e6f91fe7c90306c2c48ea9354562ee9146/readme.md#supportscolor),
[Chalk standard-error support](https://github.com/chalk/chalk/blob/661317e6f91fe7c90306c2c48ea9354562ee9146/readme.md#chalkstderr-and-supportscolorstderr)

## Recommendation matrix

| Package or surface     | Module form               | Terminal behavior                                           | Decision             | Reason                                                              |
| ---------------------- | ------------------------- | ----------------------------------------------------------- | -------------------- | ------------------------------------------------------------------- |
| Effect `CliOutput`     | Pinned v4 beta            | Colors help on a standard-output TTY                        | Keep for CLI help    | It already owns parsing and help output.                            |
| Effect `Stdio`         | Pinned v4 beta            | Separate output sinks and a standard-output TTY check       | Keep                 | It preserves the Effect test seam and stream contract.              |
| Effect `Terminal`      | Pinned v4 beta            | Input, dimensions, keys, and standard-output display        | Keep for prompts     | It already supports the required setup prompts.                     |
| Effect `Logger`        | Pinned v4 beta            | Simple, logfmt, structured, and JSON formats                | Keep for diagnostics | Command events need the stricter `Output` schema.                   |
| `chalk@6.0.0`          | ESM, Node 22+             | Separate standard-output and standard-error color detection | **Add now**          | It is a side-effect-free formatter with no dependencies.            |
| `picocolors@1.1.1`     | CommonJS with ESM interop | Global standard-output detection                            | Do not add           | It gives no destination-specific standard-error detection.          |
| `yoctocolors@2.2.0`    | ESM, Node 18+             | Basic environment detection                                 | Do not add           | It has no stream-specific instance or truecolor API.                |
| `kleur@4.1.5`          | Dual ESM and CommonJS     | Mutable global detection based on standard output           | Reject               | The mutable global conflicts with deterministic output tests.       |
| `colorette@2.0.20`     | Dual ESM and CommonJS     | Standard-output detection with manual override              | Reject               | Its last release is old and Chalk fits the stream split better.     |
| `ansi-escapes@7.3.0`   | ESM, Node 18+             | Cursor and screen escape strings                            | Defer                | Static human output does not need terminal mutation.                |
| `cli-table3@0.6.5`     | CommonJS                  | Unicode tables and ANSI-aware widths                        | Defer                | Add it only when real aligned data exceeds a small local formatter. |
| `ora@9.4.1`            | ESM, Node 20+             | One spinner on standard error by default                    | Reject now           | It owns stdin, cursor state, signals, and a render loop.            |
| `listr2@11.0.0`        | ESM, Node 22.13+          | Live task renderer with non-TTY fallbacks                   | Reject               | It duplicates workflow state and can intercept process output.      |
| `@clack/prompts@1.7.0` | ESM, Node 20.12+          | Styled prompts, logs, tasks, and spinners                   | Reject               | Effect already owns prompts, cancellation, signals, and output.     |

## Effect-native output

### CLI help

The pinned `CliOutput.defaultFormatter` applies basic ANSI styles when
`process.stdout.isTTY` is true. It disables color only when `NO_COLOR` equals
`1`. It does not detect standard-error support or `FORCE_COLOR`.
[Pinned `CliOutput` source](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/CliOutput.ts#L288-L370)

This formatter is sufficient for help because help belongs on standard output.
It is not a complete palette for repository command events.

### Standard I/O

Effect v4 `Stdio` supplies separate sinks for standard output and standard
error. It exposes `stdinIsTerminal` and `stdoutIsTerminal`. It does not expose
a standard-error terminal check.
[Pinned `Stdio` contract](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Stdio.ts#L64-L90)

The Node layer maps these sinks to `process.stdout` and `process.stderr`.
It leaves both streams open by default. This behavior matches the long-lived
command process and the current `Output` service.
[Pinned Node `Stdio` layer](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node-shared/src/NodeStdio.ts)

### Terminal and prompts

Effect `Terminal` supplies dimensions, line input, key input, and display.
`Terminal.display` writes to standard output. Prompt cancellation uses the typed
`Terminal.QuitError` error.
[Pinned `Terminal` service](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Terminal.ts),
[pinned Node terminal layer](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node-shared/src/NodeTerminal.ts)

The Effect CLI prompt module already includes confirm, text, password, file,
select, autocomplete, multi-select, date, number, list, and toggle prompts.
Adding Clack creates a second cancellation and terminal model.
[Pinned Effect prompt API](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Prompt.ts)

### Logger

Effect `Logger` supplies simple, logfmt, structured, and one-line JSON formats.
It can write through `console.log`, `console.error`, or level-selected console
methods. Logs also carry annotations and spans.
[Pinned logger formats and routing](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Logger.ts#L340-L697)

Use `Logger` for developer diagnostics. Do not route command lifecycle events
through it. The repository NDJSON format has its own version, command, stream,
event, time, and data fields.

## Color formatter comparison

### Chalk

Chalk 6 has no dependencies and exports JavaScript plus TypeScript declarations.
It supports nested styles, 16 colors, 256 colors, truecolor, and separate
standard-error detection. Its package is ESM-only.
[Chalk highlights and API](https://github.com/chalk/chalk/blob/661317e6f91fe7c90306c2c48ea9354562ee9146/readme.md#highlights),
[Chalk package metadata](https://registry.npmjs.org/chalk/6.0.0)

Its separate stream instances are the decisive feature. A command can pipe
standard output while standard error remains a terminal. One global check gives
the wrong result in that case.

### Picocolors

Picocolors has no dependencies and supports CommonJS and ESM consumers. It
provides `createColors(enabled)` for deterministic tests. Its automatic check
uses `process.stdout.isTTY`, environment variables, command flags, and CI.
[Picocolors documentation](https://github.com/alexeyraspopov/picocolors/blob/6f0a4638348ed20633d623ee973f9c9a96f65104/README.md),
[Picocolors detection source](https://github.com/alexeyraspopov/picocolors/blob/6f0a4638348ed20633d623ee973f9c9a96f65104/picocolors.js#L1-L8)

The automatic check is not destination-specific. It can also enable ANSI codes
in CI without a TTY. The repository must replace its detection to use it safely.

### Yoctocolors

Yoctocolors 2.2.0 is ESM-only and has no dependencies. It uses Node terminal
color detection and supports `FORCE_COLOR`, `NO_COLOR`, and
`NODE_DISABLE_COLORS`. It has no standard-error instance.
[Yoctocolors documentation](https://github.com/sindresorhus/yoctocolors/blob/a02a16ec36fbd58a0848e95598fb4913c54c7591/readme.md),
[Yoctocolors detection source](https://github.com/sindresorhus/yoctocolors/blob/a02a16ec36fbd58a0848e95598fb4913c54c7591/base.js#L1-L8)

The package supports basic colors and advanced underline styles. It does not
provide the RGB and truecolor API that Chalk provides.

### Kleur and Colorette

Kleur 4.1.5 supports ESM and CommonJS. It uses mutable global state and bases
automatic detection on `process.stdout.isTTY`. Its documentation warns that
the simple check does not cover all cases.
[Kleur documentation](https://github.com/lukeed/kleur/blob/fa3454483899ddab550d08c18c028e6db1aab0e5/readme.md#conditional-support),
[Kleur package](https://registry.npmjs.org/kleur/4.1.5)

Colorette 2.0.20 has dual ESM and CommonJS exports. It has no dependencies and
supports an explicit `createColors` override. Its automatic check uses standard
output file descriptor `1`.
[Colorette documentation](https://github.com/jorgebucaran/colorette/blob/811fd2f255ed6b3d56b5977353d32dae13088b65/README.md),
[Colorette detection source](https://github.com/jorgebucaran/colorette/blob/811fd2f255ed6b3d56b5977353d32dae13088b65/index.js#L1-L25)

Both packages work on Node 24. Chalk gives better maintenance, color depth, and
stream detection for this repository.

## Terminal UX comparison

### ANSI Escapes

`ansi-escapes` returns strings for cursor movement, line erasure, alternate
screens, synchronized output, links, and more. It does not detect TTY support.
The caller must select the stream and guard every control sequence.
[ANSI Escapes documentation](https://github.com/sindresorhus/ansi-escapes/blob/73e652efe7a353bdf25f456e592c858e4648db3d/readme.md),
[ANSI Escapes package](https://registry.npmjs.org/ansi-escapes/7.3.0)

Its `clearScreen` operation can clear scrollback or reset terminal modes.
Add this package only with a real interactive renderer and cleanup tests.

### CLI Table 3

`cli-table3` renders Unicode tables and handles ANSI-aware width, truncation,
wrapping, row spans, and column spans. It publishes CommonJS and depends on
`string-width`.
[CLI Table 3 documentation](https://github.com/cli-table/cli-table3/blob/9577efd51114e61fb035b7cc493adf0c0dc7921b/README.md),
[CLI Table 3 package](https://registry.npmjs.org/cli-table3/0.6.5)

The current output does not contain a large table. A small local row formatter
is simpler until a real command needs wrapping or Unicode-aware alignment.

### Ora

Ora 9.4.1 is ESM-only and requires Node 20 or newer. It writes to standard
error by default and animates only on a TTY outside CI. It supports a custom
stream and ASCII fallback spinner.
[Ora documentation](https://github.com/sindresorhus/ora/blob/79cd8c15ac34572cffb3ab53e3d4b6bab6d59ea8/readme.md),
[Ora package](https://registry.npmjs.org/ora/9.4.1)

Ora supports one concurrent spinner. Its default input control puts stdin in
raw mode. It also installs cursor and signal behavior. These owners conflict
with Effect scopes, `NodeRuntime`, and child-output streaming.

### Listr2

Listr2 11.0.0 is ESM and requires Node 22.13 or newer. It runs task functions,
tracks concurrency, and owns live renderers. Its default renderer updates
standard output and intercepts process output.
[Listr2 package](https://registry.npmjs.org/listr2/11.0.0),
[default renderer source](https://github.com/listr2/listr2/blob/e34dee8b437751fa9cf07feaa35db8888741f6d5/packages/listr2/src/renderer/default/renderer.ts),
[task runner source](https://github.com/listr2/listr2/blob/e34dee8b437751fa9cf07feaa35db8888741f6d5/packages/listr2/src/listr.ts)

The package has simple, verbose, silent, and test renderers. These features are
useful for an application that accepts Listr2 as its workflow model. MZE already
has Effect workflows and a versioned event model, so Listr2 duplicates both.

### Clack

`@clack/prompts` 1.7.0 provides styled prompts, logs, tasks, progress bars, and
spinners. It is ESM-only and requires Node 20.12 or newer.
[`@clack/prompts` package](https://registry.npmjs.org/@clack%2fprompts/1.7.0),
[`@clack/prompts` documentation](https://github.com/bombshell-dev/clack/blob/dc5bce8aae84a57b5863124adfaa839c1db1fa23/packages/prompts/README.md)

Clack defaults to standard output. Its spinner installs process signal and
exception listeners. Its prompts use raw terminal input and their own
cancellation values.
[Clack terminal helpers](https://github.com/bombshell-dev/clack/blob/dc5bce8aae84a57b5863124adfaa839c1db1fa23/packages/prompts/src/common.ts),
[Clack spinner source](https://github.com/bombshell-dev/clack/blob/dc5bce8aae84a57b5863124adfaa839c1db1fa23/packages/prompts/src/spinner.ts)

Effect already supplies prompt types and `Terminal.QuitError`. Clack adds a
second terminal lifecycle and bypasses the repository output adapter.

## Node 24 and module compatibility

Node 24.18.1 runs TypeScript that contains only erasable syntax. Node ignores
`tsconfig.json`, requires explicit relative extensions, and needs `import type`
for type-only imports. It does not transform enums, parameter properties,
runtime namespaces, import aliases, or decorators.
[Node 24 TypeScript documentation](https://nodejs.org/download/release/v24.18.1/docs/api/typescript.html)

Node does not strip TypeScript inside `node_modules`. Every package in this
report publishes JavaScript. Native stripping therefore affects repository
source imports, not these package bodies.

The repository uses ESM. Chalk, Yoctocolors, ANSI Escapes, Ora, Listr2, and
Clack fit that module system directly. Kleur and Colorette provide ESM exports.
Picocolors and CLI Table 3 rely on CommonJS interoperability.

Node exposes `isTTY`, `getColorDepth()`, and `hasColors()` on each terminal
write stream. A program must test the actual destination stream because
standard output and standard error can have different destinations.
[Node 24 TTY documentation](https://nodejs.org/download/release/v24.18.1/docs/api/tty.html)

The `NO_COLOR` convention treats any present, non-empty value as a request for
plain output. Per-command flags can override that environment default.
[`NO_COLOR` convention](https://no-color.org/)

## Deferred adoption gates

Add a terminal UX package only when a command has a measured need:

- Add `cli-table3` when output needs ANSI-aware wrapping or complex table spans.
- Add `ansi-escapes` when a tested TTY renderer needs cursor control.
- Reconsider Ora only for one exclusive, quiet operation with no child output.
- Reconsider Listr2 only if Listr2 replaces the workflow model for that command.

Do not add Clack while Effect owns prompt input and cancellation.
