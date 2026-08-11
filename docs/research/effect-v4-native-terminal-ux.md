# Effect v4 native terminal UX

**Date checked:** 2026-08-11

**Cohort:** `effect@4.0.0-beta.107` and `@effect/platform-node@4.0.0-beta.107`

## Result

Effect v4 beta.107 has strong terminal and lifecycle primitives. It has no
built-in spinner, progress bar, or task-list renderer.

MZE must keep its current static event rail. The repository `Output` service
must remain the only writer for command events. Effect can own timing,
concurrency, cancellation, and cleanup behind that service.

Do not build passive progress output with `Prompt.custom`. Do not import the
CLI ANSI helpers. Do not use `Logger` as a terminal UI.

This result supports the current decision in
[ADR-0023](../adr/0023-effect-supervises-repository-commands.md). The result
also supports the no-spinner decision in
[the terminal output report](./effect-cli-terminal-output.md).

## Release state

The repository pins one exact Effect cohort. The official tag resolves to
commit `3c495ae7c96d43bfc3b8020250562a194c2c895e`.
[Effect beta.107 package source](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/package.json)

The package exposes `Terminal`, `Stdio`, `Logger`, `Schedule`, `Stream`, and
Fiber modules through normal public paths. It exposes the CLI through the
explicit `effect/unstable/cli` path. The export map also blocks CLI internal
imports.
[Effect export map](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/package.json#L30-L53)

The normal paths do not make this cohort stable. The complete v4 release is a
beta. MZE can use these APIs with an exact pin and tests. MZE must expect API
changes during a cohort update.

## Method

This audit used the installed TypeScript sources as the exact behavior record.
It then matched each source to the official beta.107 Git tag.

The audit checked the complete CLI barrel and the package export map. It also
searched the exported Effect and Node platform sources for spinner, progress,
task-list, cursor, and render APIs.

The progress matches were unrelated stream, cache, console timer, or AI protocol
terms. The only cursor renderer was the private CLI ANSI implementation and the
interactive prompt loop.

| Surface                              | API state in this cohort                   | MZE decision                           |
| ------------------------------------ | ------------------------------------------ | -------------------------------------- |
| `Terminal` and `Stdio`               | Public paths in a beta package             | Use through repository boundaries.     |
| `Schedule`, `Stream`, and Fiber APIs | Public paths in a beta package             | Use for timing and scoped lifecycle.   |
| `Logger`                             | Public path in a beta package              | Use for developer diagnostics only.    |
| `effect/unstable/cli`                | Explicitly unstable path in a beta package | Keep behind the CLI adapter.           |
| Spinner, progress bar, task list     | No exported surface exists                 | Do not plan against a native renderer. |

## CLI and prompt surfaces

The CLI barrel exports arguments, flags, commands, completions, help data,
formatting, and prompts. It does not export a spinner, progress, or task module.
[CLI exports](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/index.ts)

`CliOutput` formats help, version text, and CLI errors. It returns strings and
does not write them. Its default formatter uses color when standard output is
a TTY and `NO_COLOR` is not `1`.
[CLI output formatter](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/CliOutput.ts#L1-L6),
[default color policy](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/CliOutput.ts#L288-L370)

`Prompt` supplies confirm, text, password, file, select, autocomplete,
multi-select, date, number, list, and toggle prompts. `Prompt.run` reads scoped
terminal input and can fail with `Terminal.QuitError`.
[Prompt constructors and runner](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Prompt.ts)

`Prompt.custom` has a frame loop and an optional external event queue. An
external event can cause a new frame without a key press. This API can look
like a progress renderer, but it has interactive prompt semantics.
[Custom prompt loop](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Prompt.ts#L776-L870)

`Prompt.run` always obtains `Terminal.readInput`. The Node terminal adapter uses
Node `readline` and raw input mode while the reader is active. Prompt frames
also go to standard output through `Terminal.display`.
[Prompt runner](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Prompt.ts#L1138-L1170),
[Node terminal implementation](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node-shared/src/NodeTerminal.ts)

These properties make `Prompt.custom` a poor passive renderer. A spinner must
not take ownership of input or enable raw mode. It also must not force output
to standard output.

The CLI has internal ANSI helpers for cursor movement, line erasure, styles,
and cursor visibility. The package export map blocks
`effect/unstable/cli/internal/*`. MZE must not depend on these private helpers.
[Internal ANSI implementation](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/internal/ansi.ts),
[blocked internal export](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/package.json#L51-L54)

## Terminal and standard I/O

`Terminal` provides these capabilities:

- `columns` and `rows`
- scoped low-level key input through `readInput`
- line input through `readLine`
- standard-output display through `display`
- typed prompt cancellation through `QuitError`

[Terminal contract](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Terminal.ts#L31-L54)

The Node adapter reads dimensions from `process.stdout`. It maps Ctrl+C and
Ctrl+D to input completion. It restores raw mode in a scope finalizer.
`display` writes to `process.stdout` in an uninterruptible effect.
[Node terminal adapter](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node-shared/src/NodeTerminal.ts)

`Stdio` provides separate standard-output and standard-error sinks. It also
provides a standard-input stream, arguments, `stdinIsTerminal`, and
`stdoutIsTerminal`. It has no `stderrIsTerminal` value.
[Stdio contract](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Stdio.ts#L54-L91)

The Node layer maps the sinks to `process.stdout` and `process.stderr`. It does
not close these streams unless the caller sets `endOnDone`.
[Node Stdio adapter](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node-shared/src/NodeStdio.ts)

`Stdio` is the correct MZE output seam. `Terminal` is the correct prompt seam.
`Terminal.display` is not a general event sink because it only writes to standard
output.

## Logger

Effect has simple, logfmt, structured, JSON, and pretty logger formats.
`Logger.consolePretty` supports color, standard-error routing, and browser or
TTY modes. Logger records can also carry annotations, fiber identity, and spans.
[Logger formats](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Logger.ts#L540-L725),
[pretty console logger](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Logger.ts#L889-L917)

`Logger` appends records. It has no cursor, frame, progress, or task-state
contract. Logger output can also break a live redraw region.

MZE must use `Logger` for internal diagnostics. Typed command events must stay
in [`Output`](../../tooling/mze/output.ts). That service owns human text and the
versioned NDJSON contract.

## Timing and progress state

`Schedule.spaced(interval)` waits for the interval after work completes.
`Schedule.fixed(interval)` keeps a wall-clock cadence. If work overruns, the
next fixed action starts immediately and missed intervals do not replay.
[Schedule timing](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Schedule.ts#L1152-L1214),
[spaced schedule](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Schedule.ts#L1520-L1558)

`Effect.repeat` runs the source once before it steps the schedule. A source
failure stops repetition. This API fits a small refresh loop.
[Effect repetition](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Effect.ts#L14528-L14670)

`Stream.tick(interval)` emits immediately and then emits after each interval.
`Stream.fromSchedule` exposes schedule outputs as a stream. `Stream.runForEach`
can consume either stream without collecting an unbounded history.
[Stream tick](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Stream.ts#L473-L512),
[schedule stream](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Stream.ts#L1280-L1320),
[stream consumer](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Stream.ts#L18918-L19192)

Use `Effect.repeat` when the repeated action emits no meaningful value. Use a
`Stream` when progress updates form a real ordered source with backpressure.

## Cancellation and cleanup

`Effect.forkScoped` interrupts a child fiber when its scope closes.
`Fiber.interrupt` requests interruption and waits for cleanup. Interruption is
cooperative, so uninterruptible work and finalizers can delay completion.
[Scoped fork](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Effect.ts#L17082-L17120),
[fiber interruption](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Fiber.ts#L340-L365)

`Effect.ensuring` runs a finalizer after success, failure, or interruption.
`Effect.onInterrupt` runs only after interruption. A live renderer needs
`ensuring` because every exit must restore the cursor and finish its line.
[Finalizer guarantee](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Effect.ts#L13080-L13220),
[interrupt cleanup](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Effect.ts#L14160-L14240)

`Stream.interruptWhen(signal)` also interrupts an active upstream pull. This
fits an event stream that must stop with a workflow.
[Stream interruption](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Stream.ts#L16648-L16770)

## Concrete recommendation for MZE

Use this policy for the pinned cohort:

1. Keep the current static event rail for human output.
2. Keep versioned NDJSON free of ANSI codes and terminal state.
3. Keep `Output.Service` as the only command-event writer.
4. Use `Stdio` sinks inside the output adapter.
5. Use `Terminal` only for explicit setup and wizard prompts.
6. Use `Logger` only for developer diagnostics.
7. Keep `effect/unstable/cli` imports inside the existing CLI boundary.
8. Add no spinner, progress bar, or task-list abstraction now.

If MZE later gets a measured need for live progress, add one renderer inside
`Output.Service`. Do not expose renderer details to workflows.

That renderer must meet these conditions:

- It runs only in human mode and on a supported TTY.
- It has one writer and does not overlap child output.
- Its refresh fiber uses `Effect.forkScoped`.
- Its refresh loop uses `Schedule` or `Stream.tick`.
- An `ensuring` finalizer restores cursor state and terminates the line.
- Tests cover success, failure, interruption, redirected output, and child logs.
- NDJSON mode never starts the renderer.

Effect supplies the lifecycle for this renderer. MZE or a selected renderer
library must supply the visual behavior. Beta.107 has no native visual surface
to adopt.
