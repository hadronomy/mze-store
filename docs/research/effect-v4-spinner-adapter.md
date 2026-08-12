# Effect v4 task-progress adapter

**Date checked:** 2026-08-11

**Scope:** A spinner or progress view for `bun run mze`

## Result

Keep task progress behind the repository `Output` boundary. Do not give a
spinner package to workflows, `ChildCommand`, or the runtime.

The smallest safe public surface is one bracketed helper. The helper gives the
workflow an update handle. A private human adapter can animate the handle. The
JSON adapter and non-terminal adapter return a no-op handle.

Do not add a package yet. If a command passes the adoption gates below, test
`yocto-spinner@1.2.2` behind the private adapter. Use `handleSignals: false`.
Its selected-stream terminal check is correct, and it does not change standard
input or raw mode. Its stream hooks still need live proof before adoption.

Keep the current static event rail if those tests fail. Do not replace Effect
workflow supervision with a task-list library.

This result extends the earlier recommendation to defer animated progress. It
does not change that first-pass decision.
[Terminal-output research](./effect-cli-terminal-output.md),
[Effect command decision](../adr/0023-effect-supervises-repository-commands.md)

## Existing owners

The design has these owners:

| Concern                                  | Owner                         |
| ---------------------------------------- | ----------------------------- |
| Human and NDJSON command events          | `Output`                      |
| Standard-output and standard-error sinks | Effect `Stdio`                |
| Child output and stream identity         | `ChildCommand`                |
| Process interruption and exit code       | `NodeRuntime` and `main.ts`   |
| Interactive input                        | Effect `Terminal` and prompts |

The pinned Effect `Stdio` service has separate output sinks. It exposes terminal
checks for standard input and standard output, but not standard error.
[Pinned `Stdio` contract](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Stdio.ts#L63-L90)

The Node `Stdio` layer writes those sinks to the matching process streams. It
does not end the streams by default.
[Pinned Node `Stdio` adapter](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node-shared/src/NodeStdio.ts)

`NodeRuntime.runMain` installs `SIGINT` and `SIGTERM` listeners. A signal
interrupts the main fiber. The runtime removes its listeners when that fiber
ends.
[Pinned Node runtime](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node-shared/src/NodeRuntime.ts)

These boundaries rule out a package that owns signals, exits the process,
changes raw mode, or becomes a second command-event writer.

## Proposed interface

Keep this helper in the `Output` module. A new application service is not
necessary.

```ts
export interface Progress {
  readonly update: (message: string) => Effect.Effect<void, PlatformError.PlatformError>;
}

export interface ProgressOptions {
  readonly command: string;
  readonly message: string;
}

export const withProgress: <A, E, R>(
  options: ProgressOptions,
  use: (progress: Progress) => Effect.Effect<A, E, R>,
) => Effect.Effect<A, E | PlatformError.PlatformError, R | Output.Service>;
```

`withProgress` selects the adapter from the existing `Output` mode. Workflows
do not import the spinner package. They also do not receive `start`, `stop`,
`success`, or `fail` methods.

The implementation shape is one bracket:

```ts
Effect.acquireUseRelease(acquireProgress(options), use, (progress, exit) => progress.clear(exit));
```

Effect protects acquisition and release from interruption. The release action
runs after success, failure, defect, or interruption.
[Pinned `acquireUseRelease` contract](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Effect.ts#L12948-L13025)

The release action must only stop the timer, clear the transient line, restore
the cursor, and remove package hooks. It must not print a final status. The
existing `Output` events and top-level `Reporter` print the final result once.

The adapter can inspect `Exit.hasInterrupts(exit)` in tests and diagnostics.
The cleanup action is the same for every exit.
[Pinned `Exit.hasInterrupts`](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Exit.ts#L484-L506)

Keep numeric totals out of this first interface. Add `current` and `total` only
when one command has truthful progress data. A spinner must not invent progress
from elapsed time.

## Adapter rules

### Human terminal mode

Write transient progress to standard error. This keeps standard output usable
for command data and pipes.

Test the actual standard-error destination. A standard-output terminal check
does not answer whether standard error is a terminal. Node exposes terminal
state on each write stream.
[Node 24 TTY API](https://nodejs.org/download/release/v24.18.1/docs/api/tty.html)

Enable animation only when all these conditions are true:

- The output mode is `human`.
- Standard error is a terminal.
- `TERM` is not `dumb`.
- The process is not in CI.
- No prompt owns standard input.
- No other progress view is active.

The human adapter owns at most one transient line. The adapter stops before a
prompt starts.

### JSON mode

Do not construct or start the package in JSON mode. `isEnabled: false` is not
enough for packages that still write plain text.

The existing `Output` service stays the only NDJSON writer. Progress updates do
not add ANSI codes, symbols, cursor commands, or unversioned records. Add a new
NDJSON event type only after its schema and consumer need are accepted.

### Child output

Keep every child byte on its original stream. Do not merge standard output and
standard error to protect the spinner.

The first adopted command must be quiet. It can use `ChildCommand.capture`, but
it must not use `ChildCommand.run` while progress is active. This gate avoids
partial-line corruption in the first layer.

A later streaming use needs live proof for all these cases:

- complete standard-output lines.
- complete standard-error lines.
- partial chunks without a final newline.
- alternating chunks from both streams.
- interruption during a partial line.
- exact stream content after the progress view stops.

The test must also prove that the package restores the original `write`
functions. A process-wide stream hook that remains installed is a release
failure.

## Package lifecycle audit

### `yocto-spinner@1.2.2`

This package is the smallest candidate for a later test. It writes to standard
error by default. Its terminal check uses the selected stream, `TERM`, and CI.
It does not read standard input or set raw mode.

The `handleSignals` option defaults to `true`. In that mode, the package adds
signal listeners and calls `process.exit()` after cleanup. The adapter must set
`handleSignals: false` because Effect owns signals and exit codes.
[Yocto Spinner types](https://github.com/sindresorhus/yocto-spinner/blob/4e51ab9b8cc6a87d3a8d42c10d2e016fe88cfe29/index.d.ts),
[signal lifecycle](https://github.com/sindresorhus/yocto-spinner/blob/4e51ab9b8cc6a87d3a8d42c10d2e016fe88cfe29/index.js#L385-L416)

While active, version 1.2.2 replaces `write` on its stream. It can also replace
`write` on both process output streams. It clears and redraws around external
writes, and it defers redraw after a partial chunk.
[Yocto Spinner stream hooks](https://github.com/sindresorhus/yocto-spinner/blob/4e51ab9b8cc6a87d3a8d42c10d2e016fe88cfe29/index.js#L90-L177)

`stop()` clears the timer, removes stream hooks, restores the cursor, clears the
line, and removes its signal listeners. The Effect release action must call
`stop()` without final text.
[Yocto Spinner stop lifecycle](https://github.com/sindresorhus/yocto-spinner/blob/4e51ab9b8cc6a87d3a8d42c10d2e016fe88cfe29/index.js#L229-L257)

The global stream hooks are the main risk. They sit below Effect `Stdio`, and
unit tests with a fake `Stdio` layer cannot prove their behavior. The live gates
below decide whether this package fits.

### `ora@9.4.1`

Ora supports `discardStdin: false`, `hideCursor: false`, a selected stream, and
an explicit terminal enable flag. The adapter needs `discardStdin: false`.
Its default puts standard input in raw mode and re-emits `Ctrl+C` from input.
[Ora options](https://github.com/sindresorhus/ora/blob/79cd8c15ac34572cffb3ab53e3d4b6bab6d59ea8/index.d.ts#L66-L123)

Ora also replaces `write` on its stream and both process output streams. Its
stop method removes timers, hooks, drain listeners, cursor state, and the input
discarder.
[Ora stream hooks](https://github.com/sindresorhus/ora/blob/79cd8c15ac34572cffb3ab53e3d4b6bab6d59ea8/index.js#L374-L453),
[Ora start and stop](https://github.com/sindresorhus/ora/blob/79cd8c15ac34572cffb3ab53e3d4b6bab6d59ea8/index.js#L511-L578)

Ora adds more lifecycle controls and dependencies than this adapter needs. It
does not remove the stream-hook risk. Do not use it as a fallback if the Yocto
Spinner live gates fail.

### Clack and Listr2

Clack's spinner installs signal, exit, exception, and rejection listeners. Its
`block()` helper also creates a readline interface, changes raw mode, hides the
cursor, and can exit the process on cancellation.
[Clack spinner lifecycle](https://github.com/bombshell-dev/clack/blob/dc5bce8aae84a57b5863124adfaa839c1db1fa23/packages/prompts/src/spinner.ts),
[Clack input block](https://github.com/bombshell-dev/clack/blob/dc5bce8aae84a57b5863124adfaa839c1db1fa23/packages/core/src/utils/index.ts#L34-L98)

Listr2 runs tasks and owns a live renderer. Its default renderer also manages
process output. That model duplicates Effect workflows and repository output.
[Listr2 task runner](https://github.com/listr2/listr2/blob/e34dee8b437751fa9cf07feaa35db8888741f6d5/packages/listr2/src/listr.ts),
[Listr2 default renderer](https://github.com/listr2/listr2/blob/e34dee8b437751fa9cf07feaa35db8888741f6d5/packages/listr2/src/renderer/default/renderer.ts)

Reject both packages for this adapter.

## Adoption gates

Adopt animated progress only after one named command passes every gate:

1. The command has a measured quiet wait that makes static output unclear.
2. The command has one progress owner and no concurrent spinner.
3. Unit tests cover human terminal, human non-terminal, and JSON adapters.
4. JSON tests prove byte-for-byte valid NDJSON with no ANSI codes.
5. Live tests cover standard output piped while standard error is a terminal.
6. Live tests cover standard error piped while standard output is a terminal.
7. Live tests cover both streams piped, CI, and `TERM=dumb`.
8. Live tests prove exact child-stream routing and partial-chunk behavior.
9. `SIGINT` and `SIGTERM` interrupt the Effect fiber and keep exit codes 130 and 143.
10. Success, failure, defect, and interruption restore the cursor and stream hooks.
11. Standard input raw mode has the same state before and after the command.
12. Process listener counts return to their starting values after every exit.
13. A failure still appears once through the existing reporter.
14. The live suite passes on macOS and Ubuntu with Node 24.18.1.

Pin the selected package exactly. Keep its import and option mapping in one
repository-owned adapter file. If a package update changes stream hooks or
cleanup, run the full live gate again.

## Decision rule

The safe first use is one long, quiet, human-only operation. JSON stays static,
prompts stop progress first, and child streaming stays outside that first use.

If the command needs concurrent task lists, intercepted logs, or numeric bars,
the proposed one-line adapter is no longer sufficient. Write a new design for
that need instead of expanding this helper into a second workflow runtime.
