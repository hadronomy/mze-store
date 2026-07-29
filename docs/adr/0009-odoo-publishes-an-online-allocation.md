# Odoo publishes an Online Allocation; commerce reserves against it

The shop is physical and runs Odoo as its ERP. Odoo remains master of true stock and publishes a per-Variant quantity allocated to online sales. Medusa's inventory module operates normally against that Online Allocation and never against shop-floor stock.

> **Scope note.** This ADR covers stock only. Odoo's role has since widened to fulfilment, accounting, and invoice issuance — see ADR-0017, which also moves the Odoo integration onto the launch path rather than leaving it as later work.

Recorded now, well ahead of implementation, because it determines whether Medusa's inventory tables are real or decorative — and that shapes catalog and checkout code being written today.

The scenario that decides it: someone buys the last unit at the till while an online Shopper has it in their cart. Odoo knows immediately; Medusa does not.

## Considered options

- **Odoo authoritative, read-through on every add-to-cart.** Always truthful, but puts the ERP in the latency path of every product page and makes the storefront fail whenever Odoo is slow or down.
- **Medusa authoritative, Odoo mirrors.** Requires no changes today, and is wrong: the till, purchasing, and returns all happen in Odoo first, so Medusa would be authoritative for movements it cannot observe.
- **Bidirectional sync.** Two systems writing the same quantity with no shared transaction is a permanent source of drift and phantom oversells.

## Consequences

Online stock reads lower than true stock, by design. Someone must own the allocation policy per Variant — that is a merchandising decision, not a technical one.

No online sale can oversell the shop floor, and the storefront keeps working when Odoo is unreachable. Reservations against the Online Allocation are only correct under a distributed lock, which is part of why ADR-0006 is not negotiable.
