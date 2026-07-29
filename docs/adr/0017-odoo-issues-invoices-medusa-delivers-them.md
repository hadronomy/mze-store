# Odoo issues Invoices; Medusa delivers them

Odoo owns the fiscal act — series numbering, the hash chain, the declaration to AEAT. Medusa owns everything the Shopper touches — the rendered document, the email, the account area, re-download.

The distinction between **issuing** and **delivering** is the whole decision, and the two verbs are easy to conflate. Conflating them is how a storefront accidentally acquires a fiscal obligation.

## Why Medusa must not issue

Spain's Veri*Factu regime requires invoicing software to hash-chain its records, keep an immutable log, print a QR on every invoice, submit to AEAT, handle certificates, and carry a formal compliance declaration. Penalties reach €50,000 per year.

**Veri*Factu is a project requirement, not a deadline to track.** The statutory dates (1 Jan 2027 for corporations, 1 Jul 2027 otherwise) set the outside limit, not the design target. Every Invoice this system delivers carries the QR and legends from the first one — see ADR-0018, where that is a renderer input rather than a later addition.

Odoo already carries the compliance. We run **Odoo Community 19**, and the official modules ship in the Community codebase (`odoo/odoo`, branch 19.0), maintained by Odoo S.A. and Odoo Spain:

- `l10n_es_edi_verifactu` — sends Veri*Factu XML to the AEAT
- `l10n_es_edi_verifactu_pos` — the same for Point of Sale, covering shop-floor takings

Both are installed. Note that this is not an Enterprise feature and does not require the OCA localisation modules; several third-party write-ups claim otherwise.

Issuing from a custom Medusa module would mean building and re-certifying a fiscal system for a small store, against a moving regulation, in parallel with a vendor who has already solved it.

## What the Shopper actually gets

An **Order Confirmation** on checkout — not a fiscal document, and it arrives before an Invoice exists. The Invoice follows once Odoo has issued it.

Checkout never touches Odoo. A sale must not depend on ERP uptime.

## Sync trigger and visibility

The Order pushes to Odoo on **payment capture** — with prepaid ecommerce the tax event lands at payment, so this both matches the accounting and gets the Shopper their Invoice quickly. Issuing at placement would invoice money that may never settle; issuing at shipment would delay it by days while leaving paid orders invisible to the system that runs the warehouse.

The push is a **tracked, durable sync record**, not a fire-and-forget event — the same pattern and the same reasoning as ErasureRequest in ADR-0015. A rejected sync (unmapped product, missing tax config, bad NIF) is likelier than an outage and much quieter. Money taken with nothing in Odoo, no Invoice, and no record that any of it should have happened is the failure mode being designed against. Failed syncs sit in a queue an Operator can see and retry.

## Consequences

- Odoo moves onto the launch path. Delivering Invoices requires the link; before it exists, Operators issue manually in Odoo and nothing is delivered automatically.
- Web sales should use their own Odoo numbering series, kept gapless independently of shop and POS. Spanish law permits multiple series.
- **Enable Veri*Factu in Odoo before the first web Invoice.** A series that begins unchained and switches later is a series with a discontinuity in it. Starting the web series under Veri*Factu from Invoice #1 avoids the question entirely — the cost of doing it early is a configuration session, the cost of doing it late is a fiscal record with a seam.
- Compliance is a vendor dependency on Odoo core. It moves with Odoo upgrades rather than being ours to maintain, which is the point of the boundary.
- Web and shop sales both flow through Veri*Factu — the storefront via `l10n_es_edi_verifactu`, the till via `l10n_es_edi_verifactu_pos`. Separate numbering series, one compliance regime.
- The Canaries sit outside VAT and under IGIC, and Veri*Factu is a state-level AEAT regime. Confirm with a gestor how it applies to IGIC operations, and how intra-EU B2C interacts with One-Stop Shop reporting. The architecture does not change either way; the configuration might.
- Confirm all specifics with a gestor. This records an architectural boundary, not tax advice.
