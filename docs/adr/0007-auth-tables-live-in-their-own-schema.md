# better-auth tables live in their own Postgres schema

One Postgres instance. Medusa owns `public`; better-auth's tables move to a dedicated `auth` schema.

Medusa creates over 150 tables in `public`. Exactly one collides with better-auth — `user` — and it is the worst available candidate: Medusa's `user` is Operators, better-auth's is Accounts. Merging staff and Shoppers into one table is a security incident, not a bug. (`session`, `account`, and `verification` are clear; Medusa uses `auth_verification` and `account_holder`.)

We move better-auth rather than Medusa because it is the small, fully-controlled side. Relocating Medusa means 150 tables, its own migration runner, and any plugin that assumes `public`.

## Consequences

There is a second, independent reason this is right: schema tooling. Drizzle would otherwise operate in a namespace containing 150 tables it does not manage, which is a permanently noisy and mildly dangerous place to run migrations and studio.

The two systems can still be joined for reporting if ever needed, which a separate database would prevent.

The Better Auth CLI owns the auth schema in `packages/db/src/schema/auth.ts`. Its CLI-only auth configuration passes `schemaName: "auth"`, so generated tables stay in this namespace. `bun run auth:schema` updates the Drizzle schema after a Better Auth version or plugin change. Drizzle Kit then creates the SQL migration with `bun run db:generate`.

Generated SQL still needs review. Better Auth cannot infer trusted identity-provider issuers or resolve collisions in existing Account rows. A schema-generation test fails if the committed Drizzle schema differs from the CLI output.
