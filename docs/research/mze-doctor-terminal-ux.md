# Terminal UX for `mze doctor`

**Date checked:** 2026-08-11

**Scope:** Doctor rows, nested details, semantic color, event data, and redirected output

## Decision

Keep the selected Variant A event rail. Make each doctor check a child of the
`doctor` lifecycle event.

Use one compact row for each check. Put evidence and a repair command on
indented child lines only for failed checks. Color only the status mark. Keep
the check name bold and keep all result text in the default terminal color.

For non-TTY output, use the same append-only lines. Remove ANSI styles,
but keep the marks, indentation, text, and order. Send the complete doctor
report to standard output. Use the exit code to report the final command state.

## Current state

The current renderer has the main parts of Variant A:

- A lifecycle row starts and ends the command.
- Each doctor check has one row.
- `✓` and `✗` carry state without color.
- Child-process output does not pass through the doctor checks.
- Chalk selects color support for standard output and standard error separately.

[Current human renderer](../../tooling/mze/output.ts)

The current doctor event uses a generic `message` event. Its `data` object has
`message`, `name`, and `passed`. The renderer detects `passed` and removes a
status mark from `message`. This makes the structured fields and the display
string describe the same state twice.
[Current doctor events](../../tooling/mze/doctor.ts)

The current human renderer colors the full check text green or red. This makes
failed detail text compete with the status mark. It also gives successful rows
more visual weight than their content needs.

A live run in this worktree produced six failed checks. Three rows ended after
the colon because their error detail was empty. The final failure row then
listed all six failed check names again. This repeated names without adding a
repair action.

The README gives the correct read-only command:

```text
bun run mze doctor
```

[README setup section](../../README.md)

It does not show output. This prevents a stale snapshot. It does not teach the
row hierarchy or show a useful failure.

Variant A remains the correct base. It gives every lifecycle event one row and
keeps detail short. The prototype also adds a separate next-action block for a
route conflict. Doctor needs the same information, but it must nest the action
under the failed check.
[Variant A prototype](../../tooling/mze/prototype/human-output.html),
[prototype decision](../../tooling/mze/prototype/DECISION.md)

## Proposed TTY layout

Indent every check by two spaces. This makes the checks children of the
top-level `doctor` event.

Use a fixed check-name column for this command. The doctor gathers all results
before it writes them, so it can use the longest check name. Cap the column at
24 characters. Put long explanations on child lines instead of extending the
summary column.

```text
→ doctor started
  ✓ platform                  linux
  ✓ node                      24.18.1
  ✓ bun                       1.3.14
  ✓ docker                    installed
  ✗ portless                  command not found
      detail                  Could not run `portless --version`.
      fix                     bun add --global portless@0.15.5
  ✗ storefront environment   file missing
      detail                  apps/storefront/.env
      fix                     bun run mze setup
  ✗ services                  not healthy
      PostgreSQL              healthy
      Redis                   unavailable
      fix                     bun run mze services start
✗ doctor failed — 3 of 10 checks failed
```

Use these placement rules:

- Color `→` cyan, `✓` green, and `✗` red.
- Color the word `failed` red in the final row.
- Keep check names bold and in the default foreground color.
- Keep summaries and details in the default foreground color.
- Dim only the lifecycle words and child labels, such as `started`, `detail`,
  and `fix`.
- Render repair commands in bold. Do not color the full command or detail.
- Do not add borders, tree characters, timestamps, or a heading.

Color reinforces the mark. It never carries the only state signal. The CLI
Guidelines recommend intentional, sparse color and warn that excessive color
reduces meaning. They also tell tools to disable color for a non-TTY stream.
[Command Line Interface Guidelines: output](https://clig.dev/#output)

Composer uses visible status markers as well as semantic colors in its outdated
output. Its verbose status output puts changed files under their dependency.
These patterns support a leading mark and indented evidence.
[Composer CLI: outdated](https://getcomposer.org/doc/03-cli.md#outdated),
[Composer CLI: status](https://getcomposer.org/doc/03-cli.md#status)

## Detail rules

A passing check gets one row. Its summary reports useful observed values.
Versions, platform, file presence, route availability,
and service health are useful observed values.

A failed check gets one short summary. Add child lines for evidence that helps
the developer identify the cause. If MZE knows a safe next command, add one
`fix` line. Do not show an empty `detail` line.

For checks with useful sub-results, use a specific child row. The services
check can show PostgreSQL and Redis separately. The environment checks can show
the missing path. Route ownership can show the owner and the Storefront-only
command.

Do not use one red paragraph for all detail. A short red mark gives the eye a
stable failure gutter. Neutral detail stays readable and lets commands, paths,
and process owners remain distinct.

Composer documents a `--tree` mode for real parent-child relations. It also
shows indented files below a dependency in verbose status output. MZE needs only
one level, so spaces are clearer than Unicode branch guides.
[Composer CLI: depends](https://getcomposer.org/doc/03-cli.md#depends-dependencies),
[Composer CLI: status](https://getcomposer.org/doc/03-cli.md#status)

## Event data

Add a dedicated doctor-check event instead of detecting `passed` inside a
generic message. Do not encode the mark in `message`.

The check event needs these fields:

```text
name: string
passed: boolean
summary: string
details: array of { label: string, value: string }
fix: string or absent
```

The event owns facts. The human renderer owns marks, indentation, alignment,
and ANSI styles. The NDJSON renderer writes the fields without terminal marks
or ANSI codes.

Always give a failed check a non-empty summary. Convert child-command errors
into a useful summary before the event reaches the renderer. Keep the child
command, exit code, and captured error text as available detail fields.

Replace the final list of failed names with counts. The failed rows already
identify the names. A final `3 of 10 checks failed` summary confirms completion
and gives new information.

This event change alters the versioned NDJSON contract. Change the stream
version with the event schema. Do not keep a fallback that parses the old
message prefix.

## Non-TTY behavior

Use complete, append-only lines. Do not rewrite a row, move the cursor, show a
spinner, or truncate text to a detected width. Composer documents
`--no-progress` for terminals and scripts that cannot process backspaces.
[Composer CLI: `--no-progress`](https://getcomposer.org/doc/03-cli.md#require-r)

For a non-TTY destination, remove ANSI styles. Keep Unicode status marks
because they are content, not terminal control sequences. The repository
supports macOS and Linux, and both use UTF-8 in the supported development path.
If the project later supports a non-Unicode terminal, add a separate capability
check and use `OK` and `FAIL` marks.

Cargo treats color, Unicode, and progress as separate terminal capabilities.
Each capability has an automatic mode, and color and progress also have
explicit overrides. This separation is a useful model for MZE.
[Cargo terminal configuration](https://doc.rust-lang.org/cargo/reference/config.html#term)

GitHub CLI disables ANSI with `NO_COLOR` or `CLICOLOR=0`. It also supports an
explicit force option for piped terminal output. MZE can continue to use Chalk
for its current stream-specific detection and force policy.
[GitHub CLI environment variables](https://cli.github.com/manual/gh_help_environment)

Docker Compose separates ANSI control from progress format. Its progress modes
include `tty`, `plain`, and `json`. MZE already has human and NDJSON modes, so it
does not need another progress renderer for doctor.
[Docker Compose options](https://docs.docker.com/reference/cli/docker/compose/#options)

Send all doctor check rows and the doctor result to standard output. They are
the primary result of this command. Keep unexpected defects, usage errors, and
package-runner errors on standard error. This makes the following command save
a complete report:

```text
bun run mze doctor > doctor.txt
```

The CLI Guidelines assign primary command output to standard output and error
messages to standard error. The doctor report is primary output with failed
checks too.
[Command Line Interface Guidelines: streams](https://clig.dev/#the-basics)

Use `--json` for automation. Emit the complete NDJSON stream on standard output
so one pipe receives every check and the final result. The exit code remains
`0` for success and `1` for failed checks.

## README treatment

Keep the current read-only description. After the renderer changes, add one
short failure example after the command. Show one passing row and one failed row
with a nested fix. Then show the final count. Do not copy all ten checks into
the README.

Use the actual `bun run mze doctor` invocation. Bun can print its package-script
command and final script error around MZE output. If the sample omits these
wrapper lines, mark it as MZE output.

## Acceptance checks

- A successful doctor run has ten child rows and one final result row.
- A failed check always has a non-empty summary.
- A repair command appears under its failed check.
- Only semantic marks and the final `failed` word use state color.
- Plain output has no ANSI escape sequences or cursor control.
- Redirected human output contains every check and the final result.
- NDJSON contains structured detail and no terminal mark in a message string.
- TTY and non-TTY output keep the same event order.
- The final result gives counts and does not repeat failed check names.
