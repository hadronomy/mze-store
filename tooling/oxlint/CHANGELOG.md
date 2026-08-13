# Changelog

## 0.0.0 - 2026-08-13

- The project rule uses Oxlint's `createOnce` lifecycle. Static setup runs once.
- `FileContext` is active from `before` through `after`. It is closed outside
  those file callbacks.
- `Visitor.onSync` compiles to a direct callback. It does not enter the Effect
  runtime for each AST event.
- `Visitor.onEffect` uses one prepared Effect runtime for file callbacks.
- The certification gate measures 10,000 callbacks in five samples. The median
  limits are 1 ms for the direct path and 25 ms for the effectful path.
- The real Vite+ lint fixture remains a required consumer check. It verifies
  diagnostics, fixes, and a clean second fix without network access.
