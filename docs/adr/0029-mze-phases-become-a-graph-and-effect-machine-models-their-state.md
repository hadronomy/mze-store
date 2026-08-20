# mze phases become a graph, and effect-machine models their state

ADR-0027 gave `mze build`, `mze check`, and `mze lint` one flat, ordered list
of phases, run sequentially, because that was the smallest thing that could
report progress correctly. It was never the smallest thing that could _run_
correctly: `check`'s six phases have real dependencies between them —
`format and lint` only needs the built oxlint plugin, `package types` and
`app types` only need built packages — but a flat list runs everything in
declaration order regardless. `oxlint plugin` and `packages` share no
dependency in any of the three commands and always could have run
concurrently.

[Prior research](../research/effect-machine-evaluation.md) evaluated
`@typeonce/effect-machine` for both halves of this problem: a phase's own
five-state run status, and the graph scheduler that decides what is ready to
run. It found the scheduler is a one-shot topological sort a handful of Effect
primitives already express, and recommended reaching for the library only for
a phase's own state — narrower, real modeling territory a statechart library
actually fits.

## Decision

`tooling/mze` becomes a package with a `src/` directory, matching every other
workspace package instead of mixing implementation, tests, and package
metadata in one flat listing. `package.json`, `tsconfig.json`, and
`vite.config.ts` stay at the package root; `prototype/`, a design-exploration
artifact rather than source, stays there too. This also makes
`packageTypecheckTask`'s cached `input` glob (`"src/**"`, from
`tooling/vite/package-tasks.ts`) match this package's real files for the
first time — it silently didn't before.

`tooling/mze/src/phase.ts` replaces the flat `Phase[]`/`runPhases` pair with a
small dependency graph, built from plain `Effect` primitives with no new
external dependency:

```ts
const packages = Phase.make("packages", vpRun(cwd, ["--filter", "./packages/*", "build"]));
const apps = Phase.make("apps", vpRun(cwd, ["--filter", "./apps/*", "build"])).pipe(
  Phase.after(packages),
);

export const build = (cwd: string): Phase.Graph => Phase.all(oxlintPlugin, packages, apps);
```

`Phase.after(dependency)` reads the way `Layer.provide` does — "self, after
dependency" — because both problems are the same shape: a declarative graph,
resolved once, nodes shared by reference. There is no `provide`-style value
handoff, because a phase produces nothing its dependent reads; `after` only
orders. A dependency is a live `Node` value, not a string name, so referencing
one that is not yet in scope is a JavaScript reference error at definition
time, not a typo a scheduler discovers at runtime. `Phase.all` still validates
one thing types cannot: two different `Node` values bound to the same name,
which fails loudly at graph construction rather than silently doubling that
phase's work.

The scheduler itself (`Phase.run`) is a `Deferred` per node and a shared
`aborted` flag: a node blocks on its own dependencies' `Deferred`s, so
unrelated ready nodes start immediately, and the first failure's own typed
error is what the whole graph fails with — a caller matching on
`ChildCommand.Error`'s tags upstream sees the same value it would from running
that one command directly.

`tooling/mze/src/phase-state.ts` adds `@typeonce/effect-machine@0.15.0` (exact
pin) to model a phase's own run status: five atomic states
(`Queued`/`Running`/`Succeeded`/`Failed`/`Skipped`), one event source (the
scheduler's neutral start/succeed/fail/skip signal). This is the one place the
statechart framing is honest — `Skip` is legal only from `Queued`,
`Succeed`/`Fail` only from `Running` — so a scheduler bug sending an event out
of order is silently ignored by the machine instead of corrupting a row that
already settled. `MachineRef.send` only guarantees mailbox acceptance, not
that a transition has committed, so `phase-state.ts` waits for its own event
to show up on the machine's `changes` stream before reporting a status —
otherwise a build's last event could race the process exit and never reach
`Renderer`/`Output` at all.

Adopting effect-machine required bumping the Effect cohort. Its peer
dependency targets `effect@4.0.0-rc.109`, one line past this repository's
prior `4.0.0-beta.107` pin (ADR-0023). `effect`, `@effect/platform-node`, and
`@effect/vitest` all move together, in every workspace that pins them
(`tooling/mze`, `tooling/oxlint`, and the root). `@effect/tsgo` (ADR-0028) does
not: its own `0.36.5` release still targets `beta.107` internally and has no
newer build. It is a known, tracked exception, not a silent mismatch — recheck
it the next time `@effect/tsgo` publishes, or when anything suggests its
patched diagnostics have drifted from what current Effect actually reports.

## Renderer and Output follow the same change

Real concurrency broke two assumptions the flat model never had to question.
`Renderer`'s `childOutput` routed every incoming chunk to "whichever row is
running" because exactly one ever was; with several rows running at once, it
now takes the phase name `ChildCommand`'s `CurrentPhase` reference carries
(provided locally by `Phase.run` around each node's own effect, read by
`ChildCommand.run` when it writes a `child-output` event) and routes to that
row specifically, dropping a chunk it cannot attribute rather than guessing.
`Row.pending` — the partial trailing line of a phase's own output — moved from
a single field on `State` to one per `Row`, for the same reason.

`Output`'s NDJSON stream gains `phase-skipped` — a skipped phase never had a
machine-readable event before, only a visual row the renderer inferred from
whatever was left `"pending"` — and `child-output` gains an optional `phase`
field. The version field moves from `2` to `3`.

`Renderer`'s settling — "whatever never ran is reported skipped, and the
failed phase's own output prints as a block" — used to be `end` and
`failureOutput`, two methods `runPhases` had to remember to call, in order, in
an `Effect.onExit`. Both are gone from the public interface now. `Renderer`
registers its own settling as an `Effect.addFinalizer` when its layer is
built, so it runs automatically when whatever scope provided that layer
closes — success, failure, or interruption — the same guarantee
`Effect.onExit` gave by hand, now structural instead of a caller's
responsibility to get right.

Making that automatic _and_ correctly ordered needed one more change.
`cli.ts`'s `execute` used to provide `Renderer` around the whole command,
including the top-level `Reporter.report` call that prints a summary line on
failure — so the finalizer would have fired after that line, settling the
rows and printing the failure block below a summary that was supposed to
follow them. `Output.layer` looked up `Renderer.Service` once, when its own
layer was built, which is what forced the wide scope: `execute` had to
provide `Renderer` before `Output` was even constructed. Moving that lookup
into `Output.write` itself — a call-time `Effect.serviceOption`, which (like
the build-time version) adds no static requirement — let `execute` provide
`Renderer` narrowly, around `workflow` alone. The finalizer now fires exactly
when a batch command's own workflow settles, before `Reporter.report` runs
afterward, outside the renderer's scope entirely. `runPhases` is left with
one job: announce the plan, then run the graph.

## Consequences

- `mze build`, `mze check`, and `mze lint` run independent phases
  concurrently. `check`'s six phases settle in as little as two rounds instead
  of six sequential steps; verified live, not just under test.
- A phase's run-state is a real, if small, statechart, giving this repository
  one more example of the "Effect-native modeling story" the effect-machine
  research treated as a legitimate motivation on its own, alongside the
  narrower state-safety argument.
- `--verbose` mode's per-chunk `writeText` is not re-framed for concurrency:
  two phases' verbose output can now interleave in real time, where a flat
  sequential run never could. This is a known limitation, not a silent one —
  `--log grouped` still buffers each Vite+ task's own output into one block,
  so only genuinely concurrent _phases_ (not tasks within one phase) can
  interleave, and only in the one mode built for raw, unshaped output.
- `tooling/mze`'s own `check-types` phase — the one this repository's
  TypeScript 7 / `@effect/tsgo` pin (ADR-0028) actually type-checks — now
  covers `phase.ts` and `phase-state.ts` directly, so a beta-to-rc-shaped
  Effect diagnostic surfaces there before it surfaces anywhere else.
- `@effect/tsgo` lagging the rest of the cohort is accepted, tracked risk, not
  a blocker: effect's own beta.107→rc.109 jump was two releases and four days
  apart with one breaking rename, and `vite-plus` has no `effect` dependency
  of its own to conflict with either pin.
- A caller can no longer reach `Renderer`'s `end`/`failureOutput`/`write`,
  because nothing outside `renderer.ts` needs them anymore. Any future
  caller that begins rows gets correct settling for free, by construction,
  rather than by remembering to copy `runPhases`'s old `Effect.onExit` block.

## Rejected alternatives

- Model the graph scheduler with effect-machine too. The research found the
  graph-readiness question sits outside what any single machine models — it
  would sit beside a hand-written scheduler, not replace it, and this
  repository's graphs are three to six nodes, not the scale that needs
  breadth-first state-space exploration to trust.
- A generic, reusable `Graph<Id, A, E, R>` engine decoupled from
  `ChildCommand`, so `doctor.ts`/`setup.ts` could plausibly reuse it later.
  Nothing today asks for that; the generics bought call-site noise for a
  future use case not yet real.
- Wave/level-based scheduling (group phases into ordered concurrent batches
  instead of per-edge dependencies). Cheaper to implement, but coarser:
  `check`'s `format and lint` needs only the built oxlint plugin, and a
  wave boundary would have made it wait for `packages` too, losing exactly
  the concurrency this change exists to gain.
- A compile-time-checked keyed DSL (object-literal graph with dependency names
  validated against sibling keys at the type level). It cannot forbid a
  forward reference to a not-yet-declared key — TypeScript's structural typing
  is order-blind — so the achievable version bought type-level machinery
  without the one guarantee it was reached for.

## Related

- [effect-machine evaluation](../research/effect-machine-evaluation.md) — the
  research this record's scope split follows.
- ADR-0023 — Effect supervises repository commands, and pins the Effect
  cohort exactly. This record moves that pin and keeps the same discipline.
- ADR-0027 — batch commands report phase rows. This record replaces its flat
  phase list with a graph and extends its NDJSON version history to `3`.
- ADR-0028 — mze pins TypeScript 7 for Effect diagnostics. `@effect/tsgo`'s lag
  behind this record's Effect bump is this record's own tracked exception.
