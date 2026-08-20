# effect-machine: an evaluation

**Date checked:** 2026-08-18

**Scope:** whether `@typeonce/effect-machine` (`typeonce-dev/effect-machine` on
GitHub) fits the planned redesign of `Phase` in `tooling/mze/src/tasks.ts` from a
flat sequential list into a small dependency graph.

**Sources:** the effect-machine GitHub repository (README, `package.json`,
`CHANGELOG.md`, commits, releases, contributors, `LICENSE`) via `gh api`, the
npm registry, and the `Effect-TS/effect` repository's own source tree —
fetched directly, not read through blog posts. Cross-checked against
[`tooling/mze/src/tasks.ts`](../../tooling/mze/src/tasks.ts),
[`tooling/mze/src/child-command.ts`](../../tooling/mze/src/child-command.ts),
[`tooling/mze/src/output.ts`](../../tooling/mze/src/output.ts),
[`tooling/mze/src/renderer.ts`](../../tooling/mze/src/renderer.ts),
[ADR-0023](../adr/0023-effect-supervises-repository-commands.md), and
[ADR-0027](../adr/0027-batch-commands-report-phase-rows.md).

## Question

`Phase` today is `{ name: string; spec: ChildCommand.Spec }`, and
`Tasks.runPhases` runs the list in order with
`Effect.forEach(phases, ..., { discard: true })`
([`tasks.ts:114-134`](../../tooling/mze/src/tasks.ts#L114-L134)). The next step
adds `dependsOn` to `Phase` and runs ready phases concurrently. Each phase must
still report `queued`/`running`/`succeeded`/`failed`/`skipped` to the
`Renderer` and the NDJSON `Output` service, exactly as it does now
([`tasks.ts:94-104`](../../tooling/mze/src/tasks.ts#L94-L104)).

Does `effect-machine` belong in that redesign — either as the model for one
phase's own run-state transitions, or as the model for the scheduler that
decides which phases are ready?

## Result

**Use it only for each phase's local run-state. Build the dependency graph with
plain Effect: a `Deferred` per node and a readiness gate for each dependency.**

Two independent reasons, either one sufficient on its own:

1. **The peer dependency requires a coordinated cohort.** `effect-machine`'s
   `package.json` declares
   `"peerDependencies": { "effect": "4.0.0-rc.109" }` — an exact version, not a
   range (confirmed below). The implementation therefore updates every
   workspace that pins the Effect cohort to `4.0.0-rc.109` in one change,
   including this package's `@effect/platform-node` and `@effect/vitest` pins.
2. **It solves a different, larger problem than "run a DAG of shell commands
   once and report progress."** `effect-machine` is a statechart library —
   compound/parallel states, history, hierarchical parent/child machines with
   mailboxes — aimed at long-lived, event-driven application state (its own
   examples are a platformer, a Pokémon battle system, and a generic
   playground). mze's phase graph is 3–6 nodes, runs once per command
   invocation, and has five flat statuses with no re-entrant transitions. The
   codebase's own house style (`ChildCommand`, `Output`, `Renderer`) already
   expresses that with services, `Effect.gen`, and typed `Schema.TaggedError`
   unions — the exact pattern ADR-0023 established and AGENTS.md's "do not
   add a second task runner" rule protects.

## What effect-machine provides

### API shape

Machines are defined in three steps: declare state and event schemas with
`Schema.TaggedUnion`, derive topology with `Machine.states`, then implement
behavior with `Machine.make({...}).handle({...})`. The quick-start example
from the README:

```ts
const State = Schema.TaggedUnion({
  Idle: {},
  Running: { count: Schema.Number },
});

const States = Machine.states(State.cases);
const CounterEvent = Machine.events(Schema.TaggedUnion({ Start: {}, Increment: {}, Stop: {} }));

const CounterDefinition = Machine.make({
  id: "Counter",
  states: States.states,
  events: CounterEvent,
  initial: { target: (to) => to.Idle(), resolve: ({ target }) => target.from() },
});

const Counter = CounterDefinition.handle({
  Idle: {
    on: {
      Start: Machine.transition({
        target: (to) => to.full.Running(),
        resolve: ({ target }) => target.from({ count: 0 }),
      }),
    },
  },
  Running: {
    on: {
      Increment: Machine.transition({
        target: (to) => to.full.Running(),
        resolve: ({ state, target }) => target.from({ count: state.count + 1 }),
      }),
      Stop: Machine.transition({
        target: (to) => to.full.Idle(),
        resolve: ({ target }) => target.from(),
      }),
    },
  },
});

const program = Effect.gen(function* () {
  const ref = yield* Machine.start(Counter);
  yield* ref.send(CounterEvent.Start());
  yield* ref.send(CounterEvent.Increment());
});
```

Source:
[`README.md`, "Quick start"](https://github.com/typeonce-dev/effect-machine/blob/main/README.md#quick-start).

The second concrete example, closer to what a phase runner would need, is
`Machine.invoke`, which starts an Effect on state entry and transitions on its
outcome — including a bare timeout:

```ts
Loading: {
  invoke: Machine.invoke({
    id: "save-document",
    effect: () => saveDocument,
    onDone: Machine.transition({
      target: (to) => to.full.Saved(),
      resolve: ({ output, target }) => target.from({ id: output.id }),
    }),
    onFailure: Machine.transition({
      target: (to) => to.full.Failed(),
      resolve: ({ error, target }) => target.from({ message: String(error) }),
    }),
  }),
},
Waiting: {
  invoke: Machine.invoke({
    id: "save-timeout",
    after: "3 seconds",
    onDone: Machine.transition({
      target: (to) => to.full.Failed(),
      resolve: ({ target }) => target.from({ message: "Timed out" }),
    }),
  }),
},
```

Source:
[`README.md`, "Effects, timers, and child machines"](https://github.com/typeonce-dev/effect-machine/blob/main/README.md#effects-timers-and-child-machines).

`invoke` also has a `child` form that mounts a complete nested statechart with
its own mailbox, and parent/child communication goes through `raise` (same
macrostep, same machine), `sendTo` (a mailbox send, processed later,
constrained by a declared `parentEvents` protocol), and `emit` (a one-way,
non-replayed `emissions` stream a machine publishes and never sends to its
parent). Source:
[`README.md`, "Send explicitly between machines"](https://github.com/typeonce-dev/effect-machine/blob/main/README.md#send-explicitly-between-machines).

The library also ships an inspection stream
(`Machine.prepare(machine).inspection`) that reports every event send,
transition, invoke lifecycle, and timer in one ordered publication — a
built-in observability seam roughly analogous to what `Renderer`/`Output`
build by hand today. Source:
[`README.md`, "Inspect a live machine tree"](https://github.com/typeonce-dev/effect-machine/blob/main/README.md#inspect-a-live-machine-tree).

### What problem it solves

Its own README states the target directly: "Schema-first state machines and
statecharts for Effect," with design principles that include "design toward
eventual inclusion in Effect core and follow its API shape, module
boundaries, ownership, and failure conventions." Source:
[`README.md`, "Design principles"](https://github.com/typeonce-dev/effect-machine/blob/main/README.md#design-principles).
That sentence is itself evidence it is not in Effect core yet — see
[Effect v4's own primitives](#effect-v4s-own-primitives) below.

It is explicitly scoped away from distribution: "The core machine model
remains local. Distributed identity, placement, transport, routing, delivery,
and remote lifecycle semantics belong to Effect Cluster and are exposed only
through explicit integration boundaries." Source: same README section. A
`./cluster` export exists as an integration point, but the machine model
itself runs in one process.

The example applications in the repository —
[`examples/platformer`](https://github.com/typeonce-dev/effect-machine/tree/main/examples/platformer),
[`examples/pokemon`](https://github.com/typeonce-dev/effect-machine/tree/main/examples/pokemon),
and
[`examples/playground`](https://github.com/typeonce-dev/effect-machine/tree/main/examples/playground) —
confirm the intended domain: interactive, long-lived, event-driven
application state, not one-shot task orchestration.

## Maturity and health

| Signal               | Value                                                                                              | Source                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Repository created   | 2026-07-28 (three weeks before this evaluation)                                                    | `gh repo view typeonce-dev/effect-machine --json createdAt`                           |
| First npm publish    | `0.1.0` on 2026-07-28T13:03:51Z                                                                    | `registry.npmjs.org/@typeonce/effect-machine` `time["0.1.0"]`                         |
| Latest version       | `0.15.0`, published 2026-08-17T17:22:04Z                                                           | `registry.npmjs.org/@typeonce/effect-machine` `time.modified`, and `dist-tags.latest` |
| Release count        | 17 published versions in 21 days (`0.1.0` through `0.15.0`, plus two patch releases)               | `gh api repos/.../tags`, `registry.npmjs.org` `versions` map                          |
| License              | MIT                                                                                                | `gh api repos/.../contents/LICENSE`                                                   |
| Stars / forks        | 118 stars, 1 fork, not archived                                                                    | `gh repo view --json stargazerCount,forkCount,isArchived`                             |
| Contributors         | 1 human (`SandroMaglione`, 139 commits) + `github-actions[bot]` (17, changeset version bumps only) | `gh api repos/.../contributors`                                                       |
| npm maintainer       | `sandromaglione` (sole maintainer)                                                                 | `registry.npmjs.org/@typeonce/effect-machine` `versions["0.1.0"].maintainers`         |
| Weekly npm downloads | 2,233 (2026-08-09 to 2026-08-15)                                                                   | `api.npmjs.org/downloads/point/last-week/@typeonce/effect-machine`                    |
| Peer dependency      | `"effect": "4.0.0-rc.109"` — an exact pin, not a semver range                                      | `gh api repos/.../contents/package.json`                                              |

Sandro Maglione runs `typeonce.dev`, an Effect-TS-focused educational site;
the commit and maintainer data above confirms this is his project, not
assumed from outside branding.

**Pace and stability.** The CHANGELOG shows the API still moving under
active redesign, not settling: `0.15.0` (2026-08-17) makes `handle` a
one-shot boundary and removes the ability to call it twice; the same release
renames `Machine.defineStates` to `Machine.states`. `0.14.0` (2026-08-17,
same day) reworks how transition coverage is reported in the testing module.
Source:
[`CHANGELOG.md`](https://github.com/typeonce-dev/effect-machine/blob/main/CHANGELOG.md).
The README itself is direct about this: "This is early-release software. Its
API may change, and each release targets one exact Effect beta... The
package is pre-1.0: a clearer or safer long-term API takes priority over
backward compatibility. Breaking changes use minor releases." Source:
[`README.md`](https://github.com/typeonce-dev/effect-machine/blob/main/README.md), top section.

**Relationship to Effect v4.** `effect-machine` is built on Effect's own
primitives, not a reimplementation of them — the README frames the whole
project as scaffolding toward an eventual first-party Effect module, and
`Machine.start` returns a `MachineRef` whose `send`/`state`/`changes` are
built from ordinary Effect concurrency primitives (queues, refs, fibers)
rather than a competing runtime. Its `devDependencies` pin `effect` and
`@effect/vitest` to the identical `4.0.0-rc.109`, and the maintainer's own
`sync:effect`/`sync-effect.mjs` script (present in earlier package.json
snapshots) exists specifically to track upstream Effect churn — evidence the
project treats itself as downstream of Effect, moving in lockstep with a
moving target.

## Effect v4's own primitives

A search of `Effect-TS/effect`'s own source tree for a first-party
answer to this problem comes back empty. `packages/effect/src/unstable/`
contains `ai`, `cli`, `cluster`, `devtools`, `encoding`, `eventlog`, `http`,
`httpapi`, `observability`, `persistence`, `process`, `reactivity`, `rpc`,
`schema`, `socket`, `sql`, `workers`, `workflow` — no `machine` or `actor`
module, at either the stable or unstable path. Source:
`gh api repos/Effect-TS/effect/contents/packages/effect/src/unstable`
(checked 2026-08-18). A grep of the package's `CHANGELOG.md` for "machine" or
"actor" turns up only substring false positives (`factory`, `arbitrary`) —
no entry describing a state-machine or actor primitive.

This matters for the recommendation two ways. There is no official Effect
answer this evaluation would be arguing against — but there is also no
Effect-native concurrency gap `effect-machine` closes that `Ref`, `Fiber`,
`Deferred`, and `Queue` do not already cover for a plain dependency graph.
The scheduler this repository needs is: track each phase's status in a `Ref`,
and start a phase once every entry in its `dependsOn` has settled. That is
what `Effect.forEach`/`Effect.all` with a readiness gate already expresses,
using primitives this codebase already imports (`src/tasks.ts:1` imports
`Effect, Option`; `src/child-command.ts:1` imports `Context, Effect, Layer,
PlatformError, Ref, Schema, Stream`).

## Fit for mze's two problems

**(a) Modeling one phase's own run-state transitions.** `queued → running →
succeeded | failed | skipped` is five states, three of them terminal, none of
them re-entered, with a linear happy path and no branching behavior beyond
"which terminal state." `effect-machine`'s value is in nested/parallel
regions, history, and typed event protocols between siblings — none of which
this state shape has a use for. `runPhases` already encodes it correctly
today as a status literal plus two typed events written straight to
`Output`/`Renderer` (`src/tasks.ts:94-104`). The implementation keeps that
scheduler contract in plain Effect and uses the machine only to guard a
phase's five local transitions. This keeps the state model explicit without
putting graph readiness or rendering inside a statechart.

**(b) Modeling the graph scheduler.** This is the part of `effect-machine`
that looks superficially relevant — `Machine.invoke` running an Effect and
branching on `onDone`/`onFailure` resembles running a phase's `ChildCommand`
and reporting success or failure. But the scheduler's actual job is not one
machine's transition table; it is deciding, across N independent phases
declaring `dependsOn`, which ones are unblocked at any moment — a
topological-order concurrency problem, not a state-transition problem. Making
that a machine means either one parent machine coordinating N invoked
children through `sendTo`/mailboxes (exactly the actor-model machinery the
README scopes toward Effect Cluster, over-built for an in-process, run-once
DAG), or N independent machines with the readiness gate rebuilt outside the
library anyway — at which point the library adds a dependency and a schema
layer around logic that still has to live in plain Effect.

## Recommendation

Adopt `@typeonce/effect-machine` only for the local phase state. Its exact
peer pin requires the repository-wide `4.0.0-rc.109` cohort, so the manifests
and lockfile move together. Keep the scheduler in plain Effect because it
decides which ready phases can start and must coordinate `Deferred`s, output,
and rendering. This boundary avoids using the library's actor-style features
for a one-shot graph while still making illegal phase transitions impossible.
