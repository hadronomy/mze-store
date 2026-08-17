# mze pins TypeScript 7 for Effect diagnostics

`@effect/tsgo` reports more about Effect code than `@effect/language-service`
does, and it reports it as suggestions that leave the exit code alone rather
than warnings that fail a build. It needs TypeScript 7.

Two packages cannot move to TypeScript 7 today, and neither block is ours.
`tooling/oxlint` builds `prefer-tilde-imports` on the TypeScript compiler API,
which the Go port does not ship. `apps/medusa` reports 34 errors from the
`@types/react` 18 and 19 duplication that Medusa 2.18 requires. The measurements
are in [the research report](../research/typescript-7-and-effect-tsgo.md).

Waiting for both would mean waiting on a third party for a benefit that applies
to one directory.

## Decision

`tooling/mze` becomes a workspace package that pins `typescript@7.0.2` and
`@effect/tsgo@0.36.5`. The rest of the repository stays on `typescript@^6`.

Two TypeScript majors therefore live in one workspace, deliberately. The split
follows a real boundary rather than a convenient one: `mze` is the only Effect
program the repository typechecks, so it is the only place these diagnostics
apply.

`bun install` runs the package's own `prepare`, which patches the TypeScript 7
binary in that package. The workspace root has no such hook and its `tsc` stays
an unpatched 6.

`mze check` runs the package's `check-types` through its `tooling types` phase,
so the check uses the package's `tsc` and not the root one.

## Consequences

- Effect diagnostics run under `tsc` for the mze tooling: 14 `schemaNumber`
  findings narrowed `exitCode` from `Schema.Number` to `Schema.Int`, and
  `lazyEffect` removed a thunk from the renderer interface.
- Suggestions do not fail the build. `includeSuggestionsInTsc` and its siblings
  can change that when the team wants a suggestion to block.
- `packages/*` and `apps/*` are unaffected. Their `check-types` tasks still run
  the root TypeScript 6.
- Two majors is a cost. A reader has to know which `tsc` a command resolves, and
  the answer is "the one in the package the task runs in". The `tooling types`
  phase is the only place that matters.
- The plugin entry in `tooling/mze/tsconfig.json` keeps the name
  `@effect/language-service`. `@effect/tsgo` ships the same language service and
  looks for that key. Naming it `@effect/tsgo` disables it silently.

## Rejected alternatives

- Move the whole repository to TypeScript 7. Blocked twice over, and one of the
  blockers is a rewrite of the rule that enforces the `~/` convention.
- Stay on `@effect/language-service` everywhere. Its findings arrive as warnings
  that fail `tsc`, so adopting a new rule means fixing every occurrence in the
  same change.
- Pin `typescript@6` for `tooling/oxlint` and move everything else to 7. Same
  two-major cost, but it splits at a boundary that exists only because of a
  dependency, and it still leaves `apps/medusa` failing.

## Related

- ADR-0012 — the Medusa backend is a tsc island in a Vite+ workspace. This is a
  second island, drawn for a different reason.
- ADR-0023 — Effect supervises repository commands, and pins the Effect cohort
  exactly. This record follows that discipline for the TypeScript pin.
- ADR-0027 — batch commands report phase rows, which added the `tooling types`
  phase this record redirects.
