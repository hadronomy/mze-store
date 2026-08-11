# Knip baseline

Run the report with:

```sh
bun run knip:report
```

The command always exits with code `0`. It is a report, not a required check.
The configuration covers each workspace and includes Medusa convention files,
TanStack route files, Vite configuration, and the Playwright project.

The configuration keeps these exceptions:

- Medusa loads its admin packages, `ts-node`, and the `vite` type declaration
  through generated admin and convention files.
- The database scripts load `@mze-store/env` and `dotenv` from
  `drizzle.config.ts`. Knip does not load that config because it reads the
  local environment while it loads.
- `rolldown` is a Vite+ toolchain dependency in the root package.
- `@axe-core/playwright` is reserved for the browser checks. The current
  browser test is a no-op until the Storefront has real flows.
- Generated build output stays outside the analysis.

The first report had unused Storefront scaffold dependencies and unused
Medusa catalog entries. This cleanup removes those entries instead of hiding
them. Make the baseline empty before you make Knip a required check.

## Vite+ cache measurement

Measured locally on 2026-08-11 with `hyperfine` after a clean task cache:

| Task                | Cold cache | Warm cache | Uncached baseline |
| ------------------- | ---------: | ---------: | ----------------: |
| Package builds      |     2.07 s |     0.19 s |            2.90 s |
| Package type checks |     2.12 s |     0.17 s |            1.75 s |

Warm cache runs save about 93% for package builds and 91% for package type
checks. A source-change probe invalidated only the changed package. Reverting
the source caused one restore run because TypeScript changed its
`dist/tsconfig.tsbuildinfo` file. The next run hit the cache.

These results support local reuse for deterministic package tasks. The cache
tasks remain opt-in. Do not enable them in normal commands or CI until the team
decides that the restore miss is acceptable.
