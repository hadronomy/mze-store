# Invoices are rendered on demand from Odoo's payload, never stored

> **The renderer choice is superseded by ADR-0023.** Takumi replaced Typst once
> it shipped a CommonJS entry point, which removed the module-format problem
> this record solves. Everything else here still holds: the renderer takes only
> Odoo's payload, and nothing rendered is ever stored. Read the Typst reasoning
> below as the record of why a subprocess looked necessary.

Medusa renders the PDF the Shopper sees, with Typst, from Odoo's invoice payload, on every request. Nothing is cached, nothing is persisted.

Odoo issues the Invoice (ADR-0017) but its own QWeb templates never reach a customer. The delivered document is Medusa's render — same content, better typography.

## The renderer takes one input

**The renderer has no access to Medusa's Order data.** Its sole input is Odoo's invoice payload. This is a structural constraint, not a convention.

Given the chance, someone will eventually recompute a total or re-derive a tax rate from the Order, because it is sitting right there and looks equivalent. It is not equivalent: Odoo's figures are what was declared to AEAT. A document that contradicts the declared record is a real problem, and the Canaries make it likelier — IGIC and VAT appear in the same catalogue and the same checkout.

**Odoo owns every number. Medusa owns only pixels.** Make divergence impossible rather than test against it.

## Why nothing is stored

Two reasons, and the second is the stronger:

- **Erasure.** A cached PDF in object storage is a rendered artifact holding a name and address that a database purge will not touch. Not storing means ADR-0015's purge has no rendered artifacts to chase.
- **Rectificativas.** Invoices get corrected — wrong address, wrong rate, a return producing a credit note. A cached PDF does not merely go stale; it becomes a superseded fiscal document still being served to a customer. There is no cache-invalidation story more reliable than having no second copy.

Rendering per request means a correction in Odoo is reflected the next time anyone looks, with no invalidation logic at all.

Note that Medusa's own invoice-generator tutorial caches PDF content in the database and marks it stale on order updates. That is the opposite of this decision, so take the tutorial's architecture and not its persistence.

## Why Typst

The renderer runs in the Medusa backend, so ADR-0012 applies and it must be CJS-consumable. That excludes the obvious modern choices: `@react-pdf/renderer` is `"type": "module"` with no CJS runtime build, and Satori is ESM-only.

Shelling out to the Typst binary sidesteps the constraint entirely — a subprocess has no module format. It renders in milliseconds, which matters because nothing is cached and every view pays full cost, and its typography is the best available for a document a customer keeps. Playwright would give better fidelity to the web design system but costs a ~300MB browser and one to two seconds per view; pdfmake is light but looks like pdfmake.

## Consequences

- A Typst binary lives in the Medusa image, and invoice templates are written in a non-JS language.
- Viewing an Invoice depends on Odoo being reachable. Acceptable — it is an account-area action, never on the checkout path.
- The Typst template carries Veri*Factu's layout requirements **from the first Invoice**, not from 2027: the QR at the start of the document before content begins, sized 30–40mm, with `QR tributario` above it and the `VERI*FACTU` legend below. These are hard constraints on the design, not decoration to add later — the QR's position and minimum size materially shape the page.
- The QR payload comes from Odoo, like every other number. Medusa renders the code; it never computes what goes in it.
