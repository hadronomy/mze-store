# Operators cannot act as Shoppers

better-auth's admin plugin supports impersonation and we deliberately do not enable it.

## Why it is tempting

Impersonation would work transparently. An impersonated better-auth session exchanges into a real Medusa customer token like any other (ADR-0013), so it would need no special support anywhere in the stack.

That transparency is the problem. It means impersonation silently confers **full commerce authority** with no additional gate — placing orders, changing addresses, completing checkouts — and every resulting record looks exactly as though the Shopper did it themselves.

## Why we do not need it

Each use case is already served, with better attribution:

- **Acting on a Shopper's behalf** → Draft Orders. `@medusajs/draft-order` is auto-registered as a built-in and is already a required dependency. Correctly attributed to the Operator, which impersonation is not.
- **Seeing what they see** → Medusa admin already shows customer detail, order history, and addresses. Read access without acting-as.
- **Reproducing a checkout bug** → the only case genuinely left, and too narrow to justify the authority.

## Consequences

The audit trail can always distinguish a staff action from a Shopper action. That property is load-bearing for ADR-0015: once impersonation exists, "who accessed this personal data" stops being answerable, which undermines the erasure records we keep specifically to demonstrate compliance.

If a checkout bug ever proves genuinely irreproducible without it, prefer a time-boxed, Shopper-consented support session over blanket admin impersonation.
