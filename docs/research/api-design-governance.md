# API design governance research

**Status:** Research record

**Checked:** 2026-08-21

**Result:** Load a general API standard and a conditional Effect playbook
through short, mandatory root `AGENTS.md` instructions. Keep each rule in one
of those two documents. Do not create another API-design skill or copy the
rules between documents.

## Storage decision

The selected structure has three parts:

1. Root [`AGENTS.md`](../../AGENTS.md) requires the general standard for every
   interface. It also requires the Effect playbook when the interface uses an
   Effect primitive.
2. [`docs/agents/api-design.md`](../agents/api-design.md) contains the complete
   general process, interface laws, failure lessons, and completion criteria.
3. [`docs/agents/effect-api-design.md`](../agents/effect-api-design.md) contains
   the version-specific module shapes, primitive choices, runtime adapters,
   failure control, resource rules, and tests.

This structure gives one owner for each rule and one mandatory instruction
tree. It keeps the always-loaded instruction file short. It also keeps
version-specific Effect details out of work that does not use Effect.

### Why `AGENTS.md` is the trigger

Codex reads `AGENTS.md` before work. It builds an instruction chain from the
repository root to the current directory. The default combined limit is 32
KiB. Files closer to the working directory take precedence.

The root instructions therefore give the strongest repository-wide trigger.
They name public and private interfaces, module boundaries, package exports,
services, adapters, options, errors, lifecycle contracts, and the Effect
branch. These names cover design requests and implementation changes that
alter an interface.

Source: [official Codex `AGENTS.md` guide](https://developers.openai.com/codex/guides/agents-md).

### Why the detailed standards are linked documents

The standards are too large for the always-loaded instruction chain. Linked
documents keep the root instructions concise and let people use the same rules
during design and review.

The split uses progressive disclosure by branch. Every interface loads the
general rules. Only Effect work loads the pinned primitive details. Both files
travel with the code and receive normal review.

### Why there is no new skill

Skills load through explicit invocation or a match against their description.
That is useful for an optional workflow, but it is weaker than `AGENTS.md` as a
mandatory gate. Large skill sets can also shorten or omit descriptions from
the initial list.

The repository already has a `design-an-interface` workflow for material API
exploration. A second API-design skill adds another trigger and another place
to maintain the workflow. The general standard points to that existing skill
when multiple designs add value.

A future skill can reference the canonical document if it adds a distinct and
tested workflow. It must not copy the rules.

Source: [official Codex skills guide](https://developers.openai.com/codex/skills).

### Alternatives rejected

| Alternative                                           | Reason                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Put the complete standard in `AGENTS.md`              | It spends the always-loaded instruction budget on details that only interface work needs. |
| Use a skill as the only storage                       | Implicit skill selection cannot guarantee the mandatory trigger.                          |
| Keep a doc with no `AGENTS.md` instruction            | Agents can miss the document before they change a private interface.                      |
| Put Effect details in the general standard            | It loads version-specific rules for every interface and hides the conditional branch.     |
| Copy Effect details into both linked documents        | It creates two rule owners and lets the copies drift.                                     |
| Add both the pointer and a duplicate API-design skill | It creates two workflow owners without adding a new capability.                           |
| Keep the rules in an Odoo-specific research note      | The lessons apply to all interfaces and need a stable, general location.                  |

## Effect v4 source findings

The Effect rules came from the exact installed source before current upstream
material. The repository pins `effect@4.0.0-rc.109`.

### Native operation shape

The core operation remains `Effect.Effect<A, E, R>`:

- `A` is the success value.
- `E` is the exact expected-error union.
- `R` is the required service context.

`Effect.result` moves typed failures into `Result.Result<A, E>`. Its source
states that defects and interruption still fail the Effect. This makes Result
a boundary value, not the native operation type.

Sources: installed `node_modules/effect/src/Effect.ts` and
[current Effect source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts).

### Services and module exports

The pinned v4 service primitive is `Context.Service`. Service modules use a
typed `Interface`, a `Service` context key, `Service.of`, `Effect.fn`, and a
`Layer` constructor.

Effect package entries use namespace exports such as
`export * as Name from "./Name.ts"`. The repository extends that namespace
shape with a tested leaf self-export in `tooling/mze` and the Odoo bridge. The
leaf self-export is a repository convention inspired by Effect package
entries, not an Effect requirement. This source evidence reversed the earlier
removal of the Odoo bridge self-namespace export.

Sources: installed `node_modules/effect/src/Context.ts`, installed
`node_modules/effect/src/index.ts`,
[`tooling/mze/src/child-command.ts`](../../tooling/mze/src/child-command.ts),
and [current Effect Context source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Context.ts).

### Direct errors and exact unions

`Schema.TaggedError` creates schema-backed, yieldable errors with a literal
`_tag`. A direct error union lets `Effect.catchTag` and `Effect.catchTags`
recover from a specific failure.

A wrapper with `{ operation, reason }` hides the useful tag one level down. A
helper that only calls that wrapper constructor adds no validation, inference,
normalization, or policy. Both abstractions failed the deletion test.

Source: installed `node_modules/effect/src/Schema.ts` and
[current Effect Schema source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Schema.ts).

### Result, defects, and interruption

Effect `Result` is a synchronous success-or-failure value. The package already
uses Effect, so another Result library creates a second public vocabulary.

The Promise adapter runs `Effect.result(program)` through `runPromiseExit`:

- a successful Exit contains an Effect Result with success or typed failure;
- an interrupt-only failed Exit maps to the adapter's cancellation policy;
- a defect remains a rejected Promise.

An external `AbortSignal` interrupts the outer fiber. The adapter must inspect
the Exit at the runtime edge when it needs to distinguish caller cancellation,
client closure, and a defect.

Sources: installed `node_modules/effect/src/Result.ts`, installed
`node_modules/effect/src/Effect.ts`, and installed
`node_modules/effect/src/Cause.ts`.

### Managed runtime and lifecycle

`ManagedRuntime.make` creates one reusable runtime for a layer. Its installed
source builds the layer lazily, caches the context, owns a scope, registers
started fibers in that scope, and closes the scope during disposal.

The adapter therefore needs one tagged `Open | Closing | Closed` state. It does
not need a second set of active `AbortController` values or several lifecycle
booleans.

Sources: installed `node_modules/effect/src/ManagedRuntime.ts` and
[current ManagedRuntime source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/ManagedRuntime.ts).

### Schema, HTTP, secrets, and options

Effect Schema decodes unknown values at trust boundaries. `Redacted` holds the
API key. The Effect HTTP client owns request construction, transforms,
timeouts, interruption, and response decoding.

Effect Optic focuses or updates an existing value. It does not improve the
construction of a new options record. Direct construction plus a small
projection gives a clearer interface.

Sources: installed `node_modules/effect/src/Schema.ts`, `Redacted.ts`,
`Optic.ts`, and the modules under `node_modules/effect/src/unstable/http`.

## Lessons captured in the standard

The Odoo bridge redesign exposed the following general problems:

- design started from runtime machinery instead of caller examples;
- a broad error wrapper erased useful tags and exact operation failures;
- Promise rejection hid the expected-error type from TypeScript;
- two Result libraries split one failure policy into two vocabularies;
- delayed layer construction moved local option failures to the first call;
- separate factories exposed a test dependency as a second product concept;
- positional optional arguments forced `undefined` placeholders;
- boolean flags and an active-call set duplicated structured runtime ownership;
- broad JavaScript `try`/`catch` replaced typed Effect recovery;
- `Cause.squash` risked merging typed failures, defects, and interruption;
- an Optic was proposed for a job that direct construction already solved;
- package exports and generated declarations did not receive enough review;
- generic guidance used API names that did not exist in the pinned version;
- speculative features increased the interface before a caller needed them.

The general replacements and completion criteria are in
[`docs/agents/api-design.md`](../agents/api-design.md). The Effect-specific
patterns and checklist are in
[`docs/agents/effect-api-design.md`](../agents/effect-api-design.md). The
implemented case study is
[`odoo-bridge-effect-result-interface.md`](./odoo-bridge-effect-result-interface.md).

## Maintenance

Keep one owner for each rule. Update `docs/agents/api-design.md` for general
interface policy. Update `docs/agents/effect-api-design.md` for Effect-specific
policy. Update the `AGENTS.md` triggers in the same change when the routing
changes.

Recheck the installed Effect source after every version change. Current
upstream source shows design direction, but it cannot authorize a symbol that
the pinned package does not contain.

Add an ADR when a change alters ownership, package entries, failure policy, or
another difficult-to-reverse product boundary. Keep research notes as evidence
and mark superseded decisions clearly.
