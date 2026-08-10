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
