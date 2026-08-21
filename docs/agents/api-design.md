# Interface design standard

Use this standard for every new or changed public or private code interface.
An interface is every fact that another part of the system must know to use a
module. It includes names, types, exports, options, errors, defaults, resource
ownership, ordering, interruption, and performance promises.

The goal is a deep module: a small and clear interface that hides substantial
behavior. A caller must not need implementation knowledge to use it correctly.

This document is the repository source of truth. `AGENTS.md` loads a short
mandatory pointer before work starts. This gives the rule a reliable trigger
without putting the full standard in every prompt. Skills depend on discovery
and description matching. Keep mandatory repository policy here. A skill can
reference this document when it adds a distinct workflow, but it must not copy
the rules.

## Source order

Never design from memory when the interface depends on a library or framework.
Use sources in this order:

1. Read `CONTEXT.md`, the architecture, relevant ADRs, and the closest working
   modules. These files define repository language and constraints.
2. Read the source, types, tests, and documentation for the exact dependency
   version installed in this repository.
3. Read current upstream source and official documentation when the installed
   version does not answer the question.
4. Use secondary material only to find primary sources or compare experience.

Pinned source wins over remembered APIs, current examples for a different
version, and generic skill guidance. When guidance conflicts with compiled
types or pinned source, follow the source and update the guidance if it belongs
to this repository.

## Required design process

### 1. Define the caller and the seam

Write the real caller examples before the implementation. Include:

- the most common successful call;
- one expected failure and its recovery;
- cancellation or interruption when the operation can wait;
- resource cleanup when the interface owns a resource;
- dependency replacement when a real adapter seam exists.

Record the interface facts that these examples need:

- accepted input and trusted input;
- returned value;
- exact expected errors;
- defect behavior;
- interruption behavior;
- defaults and units;
- resource owner and lifetime;
- concurrency and ordering promises;
- relevant performance limits.

The step is complete when each caller can use the interface without reading its
implementation.

### 2. Inspect local and primary examples

Find the strongest nearby module with the same kind of boundary. Read its full
module shape, tests, and package exports. Then inspect the installed dependency
source for every primitive that controls the design.

Use small type probes when a generic, overload, or failure channel is unclear.
Compile the probe against the repository version. Do not infer runtime behavior
from a declaration alone when source or tests can settle it.

### 3. Design usage before declarations

For a new interface or a material redesign, compare at least three distinct
shapes before selection. Use the `design-an-interface` skill when it is
available. Make the alternatives different in ownership or policy rather than
in names alone.

Useful alternatives often include:

- the smallest common-case interface;
- a capability-oriented interface;
- an adapter or workflow-oriented interface.

Show complete caller code for each design. Include failure and cleanup code.
Compare these properties:

- call-site steps and imports;
- inferred success and error types;
- invalid states the caller can construct;
- implementation behavior hidden behind the interface;
- ease of testing through the normal interface;
- cost of adding the next known capability;
- concepts and policies that a caller must learn.

For a small change that keeps the current contract, test the existing shape
against this standard. Do not create artificial alternatives.

### 4. Select one coherent policy

Choose one name for each concept, one creation path, one error policy per
audience, and one resource owner. Remove obsolete alternatives. Do not add a
compatibility layer unless a current requirement demands it.

Write down why the selected shape is deeper than the alternatives. Prefer the
shape that removes caller decisions while it preserves real capability.

### 5. Implement from the trusted core outward

Keep domain behavior in one core. Put decoding, transport adaptation, runtime
execution, and framework integration at their actual boundaries. An adapter
must translate a policy. It must not duplicate the business operation.

Keep implementation-only types private. Expose a seam only when callers need a
different implementation. A test double alone does not justify a new public
interface. When dependency injection is a normal product need, expose it
through the normal options or Effect service context.

### 6. Audit the finished caller experience

Read the implementation last. First, use the built package exactly as a caller
does. Inspect generated declarations and all package entry points. Confirm that
the examples still infer the intended types without annotations or assertions.

The work is complete only after the focused tests, formatting, anti-slop lint,
and the repository check pass.

## General interface laws

### Make the module deep

- Keep the public surface smaller than the behavior it hides.
- Put defaults, validation, resource safety, and dependency wiring inside the
  module when the caller cannot make a better decision.
- Test through the normal interface. A module that needs internal access for
  routine tests has a weak seam.
- Apply the deletion test. If removing an abstraction changes no meaningful
  caller code, remove it.
- Do not wrap a constructor or function with a new name unless the wrapper adds
  policy, validation, inference, normalization, or a stable semantic operation.

A helper such as this has no interface value:

```ts
const makeError = (reason: Reason) => new DomainError({ reason });
```

Construct the error directly or define a helper that enforces a real invariant.

### Keep one concept in one place

- Use the domain terms from `CONTEXT.md`.
- Give one concept one name across code, tests, and documentation.
- Do not expose both a generic wrapper and its nested reason as competing error
  models.
- Do not expose two factories that differ only by a dependency used in tests.
- Do not expose two client views when one policy serves the supported caller.
- Project a broad internal value into a narrow operation input at the boundary.

### Design exact types

- Give each operation its exact success type and exact expected-error union.
- Keep a closed domain interface concrete. Add a generic only when it preserves
  a real relationship between inputs and outputs. Never let a caller-supplied
  type parameter claim the shape of untrusted data. Bind an internal generic to
  the schema or decoder that proves the result.
- Use tagged unions for states and errors that callers must distinguish.
- Make fields `readonly` unless mutation is part of the contract.
- Use a brand or opaque type only when it prevents a real category error.
- Reflect useful runtime guarantees in the decoded type. For example, use a
  non-empty array type when the decoder proves that an array is non-empty.
- Export separate encoded and decoded aliases when callers work on both sides
  of a codec. Do not make callers reconstruct the wire type.
- Decode `unknown` at the first trusted boundary. Keep `unknown` and `any` out
  of domain code.
- Annotate public return types when they are contracts. Let local implementation
  details infer when the inferred type stays clear.
- Export a useful type alias for a complex recurring type. Do not export aliases
  that only rename a primitive.
- Check generated declarations. Source-level inference can hide an unusable or
  leaked public type.

### Make options easy to call

- Use one options object when optional values belong to one operation.
- Let the common call omit the options object.
- Make optional-property types agree with runtime decoding, including in a
  downstream project that does not enable `exactOptionalPropertyTypes`. Decide
  whether an explicit `undefined` is accepted, then test that decision.
- Put a non-Effect call's cancellation signal beside its other call options.
- State units in non-Effect names, such as `requestTimeoutMs`.
- Use the native library input type when callers already use that library.
  Use an explicit unit at a plain JavaScript boundary.
- Apply defaults once at construction or at the operation boundary.
- Accept a replaceable platform dependency, such as `fetch`, in the normal
  creation options when callers and tests both need it. Give it the platform
  default.
- Do not use an optic to build a new record. Optics focus or update an existing
  structure. Use direct construction and a small projection such as
  `Struct.pick` when that expresses the work.
- Replace clusters of related booleans with a tagged state. A state model must
  make invalid combinations impossible.

### Make ownership explicit

- State who creates, shares, closes, and interrupts each resource.
- Make `close` idempotent.
- Return the same completion while close is in progress.
- Support `Symbol.asyncDispose` for a Promise client that owns asynchronous
  resources.
- Use the library's scope and runtime ownership before adding a second registry
  of active calls or resources.
- Add custom tracking only after a test proves that the underlying scope cannot
  provide the required behavior.

### Design package exports for their audience

- Give each package entry one audience and one vocabulary.
- Keep transport, runtime, and implementation modules private.
- Do not relay the same capability through several entry points without a
  caller requirement.
- Use explicit root exports when they make the package contract easy to audit.
- Use a self-namespace export in a cohesive leaf module when the namespace is
  the intended interface.
- Test every declared ESM and CommonJS condition by loading the built package.
- Inspect declaration graphs for accidental framework types, private paths, or
  unsupported global library requirements.
- Export structural guards for errors that can cross duplicated ESM and
  CommonJS module instances. Do not make `instanceof` the only safe check.
- Document defaults, units, lifecycle, and failure policy beside the public
  entry. Types cannot express every interface fact.

## Error policy

Errors are part of the interface. Design them with the success values.

### Separate three failure kinds

1. An expected error is a value in the typed error channel.
2. A defect is an unexpected bug or broken invariant. It remains a defect.
3. Interruption stops work. Preserve it in the native concurrency model. Only
   translate it when an outer interface has an explicit cancellation policy.

Do not convert all three kinds into one generic error. This makes recovery less
safe and hides defects.

### Use direct, useful tagged errors

- Define one named tagged error for each recovery action or meaningful caller
  diagnosis.
- Put useful and safe fields directly on the error.
- Keep credentials, request headers, response bodies, and secret-bearing causes
  out of public errors.
- Use exact operation unions. An operation must not claim errors that it cannot
  produce.
- Catch or recover by tag when the policy handles a specific error.
- Map infrastructure errors once at the domain seam. Preserve useful status,
  field, and protocol detail without leaking library internals.

Avoid a single tagged wrapper that contains a second tagged `reason`. It hides
the useful tag from normal recovery, adds navigation at every call site, and
usually forces one broad error union on all operations.

Do not catch every failure and map it to one generic error. Recover named
expected errors at the seam that owns the policy. Preserve defects and
interruption until their declared outer boundary.

## Effect interfaces

When an interface or implementation uses any Effect primitive, read and apply
the mandatory [`effect-api-design.md`](./effect-api-design.md) playbook. This
includes `Effect`, `Context`, `Layer`, `Schema`, `Result`, `Data`, `Stream`,
`Schedule`, `Cache`, the Effect HTTP client, and runtime adapters.

The linked playbook owns Effect module structure, `Service`/`make`/`layer`
roles, namespace exports, direct tagged errors, tagged lifecycle state,
resource ownership, HTTP policy, Promise adapters, and Effect tests. Complete
both documents' checklists. The installed Effect source wins when generic
guidance names an API that is absent from the pinned version.

## Pain points that this standard prevents

| Pain point                                                     | Root cause                                                    | Required replacement                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Caller code needs nested error-tag checks.                     | One generic error wraps the useful tagged reason.             | Export direct tagged errors and exact operation unions.                  |
| Every operation advertises every package error.                | A package-wide union replaced operation contracts.            | Define a narrow union beside each operation.                             |
| A helper only forwards arguments to a constructor.             | The wrapper has no policy or invariant.                       | Construct directly or add real semantic work.                            |
| A Promise API hides expected rejection types.                  | TypeScript has no rejected-Promise generic.                   | Return a typed result value when callers must recover by type.           |
| Two factories differ only by a test dependency.                | Dependency replacement became a second product concept.       | Put the replacement in the normal options and give it a default.         |
| Invalid options fail during the first remote operation.        | Local validation happens inside delayed construction.         | Decode and normalize local options when the client is created.           |
| Several booleans model one lifecycle.                          | Independent fields permit invalid state combinations.         | Use one closed state model and one resource owner.                       |
| Conditional construction obscures one optional field.          | The implementation works around its own options type.         | Build the record directly and project the operation input.               |
| An optic constructs a new record.                              | An abstraction for focus and update is used outside its job.  | Use direct construction or a small projection.                           |
| Tests cover success and thrown errors only.                    | Tests mirror code paths instead of interface facts.           | Test exact errors, defects, cancellation, cleanup, and declarations.     |
| Public errors retain request or cause data.                    | Diagnostic detail crosses a secret boundary without a policy. | Export safe fields and keep sanitized diagnostics in the owned boundary. |
| Features appear before a caller needs them.                    | Speculative breadth replaces module depth.                    | Implement the smallest complete end-to-end capability.                   |
| Effect code invents control flow or copies stale API guidance. | The pinned primitive set did not guide the design.            | Apply the linked Effect playbook against installed source and types.     |

## Completion checklist

An interface change is complete only when every relevant statement is true:

- [ ] The design uses the terms in `CONTEXT.md`.
- [ ] The caller examples cover success, expected failure, interruption, and
      cleanup where relevant.
- [ ] The interface facts state errors, defects, defaults, units, ownership,
      and ordering.
- [ ] A material design compares three distinct shapes before selection.
- [ ] The design follows the exact installed dependency source and types.
- [ ] If the interface uses Effect, the Effect playbook checklist passes.
- [ ] Each operation has an exact success type and exact expected-error union.
- [ ] No wrapper, helper, factory, state field, or public type lacks a semantic
      job.
- [ ] The common call has no placeholder argument, duplicate option, or manual
      infrastructure wiring.
- [ ] Trusted and untrusted data have a visible decode boundary.
- [ ] Secrets cannot appear in public errors, causes, logs, or snapshots.
- [ ] Resource creation, cancellation, closure, and disposal have one owner.
- [ ] The implementation keeps defects separate from expected errors.
- [ ] Package exports and generated declarations expose only intended types.
- [ ] Every generic represents a proved input-output relationship and cannot
      assert the shape of untrusted data.
- [ ] Focused tests cover the interface contract, including failure and
      lifecycle paths.
- [ ] Formatting, anti-slop lint, and `bun run check` pass.
- [ ] `bunx knip --no-exit-code --reporter compact` was run when package entries
      or dependencies changed.

## Repository examples and sources

Use repository modules as working examples, not as templates to copy without
judgment. The Effect-specific examples and source ledger are in the
[`effect-api-design.md`](./effect-api-design.md) playbook.

Primary guidance for the storage decision comes from the official
[Codex `AGENTS.md` guide](https://developers.openai.com/codex/guides/agents-md)
and [Codex skills guide](https://developers.openai.com/codex/skills). The
research record is
[`docs/research/api-design-governance.md`](../research/api-design-governance.md).
