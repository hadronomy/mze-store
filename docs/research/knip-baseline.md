# Knip baseline

Run the report with:

```sh
bunx knip --no-exit-code --reporter compact
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
- `uuid` keeps Medusa's Jest loader on its CommonJS-compatible version while
  Effect uses its declared ESM-only version.
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
| Package builds      |     1.11 s |     0.18 s |            1.04 s |
| Package type checks |     2.10 s |     0.17 s |            1.83 s |

Warm cache runs save about 83% for package builds and 91% for package type
checks. A source-change probe invalidated the changed package and its dependent
package. The unrelated packages stayed cached. Reverting the source restored
the original cache entry on the next run.

These results support cache reuse for deterministic package tasks. The normal
package build and package type-check commands now use cached Vite+ tasks. Their
input rules exclude TypeScript incremental state and their build output rules
exclude that same state from restoration. The source-change probe found no
stale result. A later run restored the cache after the source returned to its
original content. The warm-run savings outweigh the cold-cache cost, so the
normal commands and CI use these tasks.

CI restores the Vite+ task cache after dependency installation and saves a new
entry after a successful checks job. Database work, migrations, seeds, tests,
development servers, and application builds stay uncached.
