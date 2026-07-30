# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary.
- **`docs/adr/`** — currently `0001` through `0018`. Read the ones that touch the area you're about to work in.
- **`docs/architecture.md`** — layout, request paths, identity, territory, stock, build toolchain, layer discipline.
- **`docs/roadmap.md`** — phases and their exit criteria, plus what is deliberately deferred.

This repo is **single-context**: one `CONTEXT.md`, one `docs/adr/`. It is a bun-workspaces monorepo, but the packages are layers of one commerce domain rather than separate bounded contexts, so there is no `CONTEXT-MAP.md` and there are no per-package ADR directories. Don't create either.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

The glossary is unusually load-bearing here: three of the systems in play each ship a table called `user`, meaning three different things. `Customer`, `Account`, and `Operator` are not interchangeable, and using the wrong one silently describes a different thing.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (auth tables in their own schema) — but worth reopening because…_

Several ADRs here exist specifically to record a **rejected alternative that looks better on first reading** — notably 0013 (shared JWT signing) and 0010 (a search service). Before proposing one of those, read the ADR; the reasoning is the point, not the verdict.
