# Changelog

## 0.0.0 - 2026-08-13

- The project rule uses Oxlint's `createOnce` lifecycle. Static setup runs once.
- `FileContext` is active from `before` through `after`. It is closed outside
  those file callbacks.
- `Visitor.onSync` compiles to a direct callback. It does not enter the Effect
  runtime for each AST event.
- `Visitor.onEffect` uses one prepared Effect runtime for file callbacks.
- A separate Vitest benchmark measures `Visitor.onSync`, `Visitor.onEffect`,
  and the real Vite+ consumer fixture. CI publishes the benchmark reports
  without an absolute timing gate.
- Baseline report schema 3 contains deterministic contract data only. Timing
  belongs to the separate benchmark.
- The real Vite+ lint fixture remains a required consumer check. It verifies
  diagnostics, fixes, and a clean second fix without network access.
