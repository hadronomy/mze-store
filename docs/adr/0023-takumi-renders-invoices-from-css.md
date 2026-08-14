# Takumi renders Invoices from the same CSS as the Storefront

Supersedes ADR-0018's choice of renderer. Everything else in ADR-0018 stands: Odoo still issues, the renderer still sees only Odoo's invoice payload, and nothing rendered is ever stored.

ADR-0018 chose the Typst binary for one reason above the others. Medusa's backend compiles to CommonJS file by file (ADR-0012), and a subprocess has no module format, so shelling out sidestepped the constraint that makes shared TSX packages dangerous. It recorded the cost honestly: Playwright "would give better fidelity to the web design system but costs a ~300MB browser and one to two seconds per view".

Both halves of that reasoning have moved.

## Decision

`takumi-pdf` renders the Invoice. It takes JSX, an HTML string, or a JSON node tree, and writes a paged vector PDF with selectable text and embedded subset fonts.

The module-format objection is gone. `takumi-pdf` publishes a dual `exports` map — `node.require` resolves to `./bundlers/node.cjs`, and `main` is `./dist/export.cjs` — so the CommonJS backend can `require()` it. `@takumi-rs/core` does the same. No dual-emit of our own code is involved, because the package ships both formats itself.

The fidelity cost is gone too. Takumi is a real CSS engine, not a Satori-style subset:

- `takumi-core/src/style/stylesheets_vars.rs` resolves `var()`, with fallbacks, a cycle guard, and depth and byte ceilings taken from Blink.
- `takumi-core/src/style/properties/color.rs` parses `oklch`, `oklab`, and `color-mix`.
- The engine handles CSS Grid, `:is()`, `:where()`, `::before`, `::after`, masks, `clip-path`, blend modes, and Tailwind v4 utilities including arbitrary values.

So the Invoice reads the same custom properties as the Storefront, from `@mze-store/design-tokens` (ADR-0024). One brand, one type scale, one palette, proven by construction rather than by a second set of templates kept in step by hand. That is what ADR-0018 wanted from Playwright, at about 4MB and with no browser.

Use the **JSON node tree**, not JSX. The backend is a `tsc` island emitting file-per-file CommonJS, and putting TSX in it re-opens exactly the boundary ADR-0011 and ADR-0012 keep shut. A node tree is plain data and crosses nothing.

Fonts are registered on the renderer from `fontFile` in the token package, which is the same list the Storefront's `@font-face` rules read. A weight added in one place appears in both.

## Rejected alternatives

- **Keep Typst.** Its typography is excellent and its module-format immunity is real. But it cannot read the design system, so the document a Shopper keeps would drift from the shop they bought it in, and the templates would be maintained in a second language for no remaining reason.
- **Playwright.** Same fidelity, ~300MB of browser and seconds per view. ADR-0018 priced this correctly; takumi simply arrives at the same place cheaply.
- **JSX with takumi.** Better authoring, but it needs TSX inside the CommonJS island. The node tree gives the same output with no boundary crossing.

## Consequences

- The renderer gains a Node dependency where it had a subprocess. If takumi's CommonJS entry ever regresses, the Invoice breaks at `require` time, which is loud and immediate rather than subtle.
- Invoice templates become node trees in TypeScript. They are testable in the same runner as the rest of the backend, which Typst templates were not.
- Nothing is cached and every view still pays full render cost, so the renderer stays on the payload-only input that makes that safe.
- Phase 7 no longer needs the Typst binary in the Medusa image.

## Related

- ADR-0018 — Invoices are rendered, never stored. Superseded on the renderer only.
- ADR-0017 — Odoo issues, Medusa delivers.
- ADR-0012 — the Medusa backend is a `tsc` island.
- ADR-0011 — email templates are not shared; only tokens are.
- ADR-0024 — the design token system.
