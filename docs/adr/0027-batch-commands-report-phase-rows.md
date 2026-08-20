# Batch commands report phase rows

ADR-0023 gave `mze` one output seam with a human adapter and an NDJSON adapter.
It said human output is concise. That was true of the events `mze` writes itself
and false of everything else: `build`, `check`, and `lint` each run several
Vite+ invocations and pass every byte those produce straight to the terminal. A
successful `mze build` printed about a hundred lines, of which seven mattered.

The first output pass deliberately added no animated progress. Its research
report left two gates: add `ansi-escapes` when a tested TTY renderer needs
cursor control, and reconsider Ora only for one exclusive, quiet operation with
no child output. This record meets the first gate and declines the second on its
own terms, because a batch command is nothing but child output.

## Decision

`mze build`, `mze check`, and `mze lint` declare their work as a list of named
phases and report each one as a row.

A phase list is data. `Tasks.build`, `Tasks.check`, and `Tasks.lint` return
`ReadonlyArray<Phase>` rather than running processes, so every row can be shown
before the first process starts and so the tests assert a value instead of
recording calls through a fake service. `Tasks.runPhases` executes a list.

On a terminal the rows animate: a spinner, the phase name, and beneath it the
Vite+ tasks running inside that phase, each with its own spinner and command.
A finished row shows `✔` and its elapsed time. A failed row shows `✗`, every
phase that never ran shows `○ skipped`, and the failed phase's captured output
prints once beneath the settled list.

```
  ✔ oxlint plugin  1.0s
  ⠙ packages
      ⠙ @mze-store/ui#build  vp pack
      ⠙ @mze-store/auth#build  vp pack
  ○ apps
```

Subtask rows are transient. A task appears when the runner announces it and
leaves when the runner closes it, and it carries no mark of its own. That is not
a simplification: `--log grouped` frames every task with a start line and an end
line, but never says in the stream whether one passed. Only
`vp run --last-details` knows, and only afterwards. A row that cannot be marked
honestly is better unmarked, and a finished task leaving the display says
everything a `✔` would.

`mze format` renders no rows, because one phase is a sentence rather than a
table. `mze test` streams its reporters unwrapped: hiding a test reporter behind
a spinner removes the output a test run exists to produce. `doctor` and `setup`
keep the formats they already have; their rows are results and prompts, not
progress.

Vite+ runs underneath with `--log grouped`. It has no programmatic task API —
its native binding exposes only a whole-CLI `run(options): Promise<number>`
whose callbacks dispatch sub-commands rather than observe them. Phases are
therefore `mze`'s own invocations, which it can account for directly.

Subtask rows come from reading two markers in that output:

```text
[@mze-store/db#build] ~/packages/db$ vp pack ⊘ cache disabled   task started
── [@mze-store/db#build] ──                                     task finished
```

Reading a tool's human output is a coupling worth naming. Three things make it
acceptable here. The runner prints both markers, not the tool inside it, so they
do not vary with `vp pack` against `tsc` against `varlock`. They are structural
rather than prose. And the fallback is total: when nothing matches, the phase
row shows the last line of output instead, which is what it would have shown
anyway. `--log grouped` also buffers each task into one block, so a failure log
reads in order rather than braided from four concurrent tasks.

## Interface

`--verbose` (`-v`) replaces the live view with every task's output, framed by a
rule per phase. It does not forward to `vp -v`, which means something else.
With `--json` it is a documented no-op rather than an error: NDJSON already
carries every child chunk, and rejecting a harmless combination is hostile in
the automated context where flags get composed mechanically.

The NDJSON stream gains `phase-plan`, `phase-started`, `phase-succeeded`, and
`phase-failed`, and `succeeded` gains an optional `elapsedMillis`. The version
field moves from `1` to `2`. A structural concept the human view shows must not
be hidden from the machine view, or the two adapters disagree about what
happened.

Three lines about one failure are not three reports. The `✗` on a row is
status, the block beneath it is the child's own output, and the typed error
belongs to the reporter. ADR-0023's rule that a failure appears once still
holds, and the reporter remains its only author.

## Module shape

`Renderer` is a service beside `Output`, not a mode inside it. Its frame
function is pure — rows and a width in, a block out — so the bulk of its tests
assert strings, and one test drives the loop with `TestClock` to prove it ticks,
stops, and restores the cursor. `Output` stays the only writer of command
events and delegates child output to the renderer when one is present; the
renderer owns the cursor, so nothing else may write while a frame is on screen.

One renderer fiber lives for the command, owned by the layer scope that
`execute` provides. The cursor is hidden on start and restored by that scope's
finalizer, so an interrupt cannot leave a terminal without a cursor.

`TerminalCapabilities` answers `isTerminal` and `columns` for the render stream.
Rows draw on standard error, so `mze build | tee` receives results rather than
animation frames. Effect's seams answer for the wrong stream — `Stdio` has no
standard-error terminal check and `Terminal.columns` reports standard output —
so both escapes live behind one injectable port instead of scattered
`process.stderr` reads. Width is read per frame, which handles a resize without
a signal handler.

`ansi-escapes@7.3.0` is added, pinned exactly. It returns escape strings and
performs no detection of its own, so the caller keeps the terminal policy.

## Consequences

- A successful `mze build` prints one row per phase and a total, and the output
  a developer needs on failure is still there, in order, and complete.
- Vite+ output arrives in bursts at task completion rather than continuously,
  because `grouped` buffers it. Subtask rows are unaffected, because their
  markers are printed at the moment each task starts and ends.
- The subtask parser reads a beta tool's human output. A Vite+ release can
  change those two lines, and the failure is a degrade to the previous tail
  behaviour rather than a break. The parser is tested against captured output.
- A terminal that reports a width of `0`, as `script` and some CI
  pseudo-terminals do, is treated as unknown. Taken literally it leaves no room
  for text and truncates every label away.
- Failure output is buffered whole rather than tailed. The 16 KB tail that
  `ChildCommand` keeps for its typed errors truncates the head, which is the
  part naming the first error.
- `tooling/mze/src/tasks.test.ts` asserts a phase list, and the NDJSON schema in the
  live suite moves to version 2.
- Ora and Listr2 remain rejected. Ora owns stdin, cursor state, signals, and a
  render loop that Effect scopes already own. Listr2 duplicates the workflow
  model.

## Related

- ADR-0023 — Effect supervises repository commands. This record extends its
  output section; the seam, the exit-code contract, and the one-failure rule are
  unchanged.
- [Terminal output research](../research/effect-cli-terminal-output.md) — the
  deferred adoption gates this record meets.
