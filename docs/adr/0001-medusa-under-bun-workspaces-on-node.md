# Medusa runs under bun workspaces, with node as the runtime

The repo uses bun as its package manager, and public reports claim Medusa v2 broke under bun somewhere around 2.13. We verified otherwise by scaffolding a throwaway workspace: Medusa 2.18 builds, migrates, and serves under bun 1.3.14, provided it is _executed_ with node rather than the bun runtime.

## Consequences

Four requirements that produce misleading errors when missed, all found empirically rather than from documentation:

- **Never declare `@mikro-orm/*` directly.** Bun's isolated layout resolves a hand-pinned copy alongside Medusa's transitive one, and MikroORM refuses to start when its packages disagree on version. Let Medusa's own dependencies decide, or pin every `@mikro-orm/*` together.
- `ts-node` and `@swc/core` must be devDependencies, or `medusa-config.ts` fails to load with a bare `Cannot find module`.
- `react` and `react-dom` must be present, or the admin bundle fails on `react/jsx-dev-runtime`.
- `@medusajs/draft-order` is auto-registered as a built-in and must be an explicit dependency.

The `medusa` binary lands in the backend's own `node_modules/.bin`, not the workspace root. In production, `medusa start` runs from `.medusa/server`; `medusa develop` runs from the app root.
