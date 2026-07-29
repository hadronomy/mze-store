# Email templates stay with their owner; only design tokens are shared

Two systems send email. better-auth sends verification and password reset from the storefront; Medusa sends order confirmations from the backend. One Resend account, two separate integrations, templates living with whichever system owns the trigger and the data.

The tempting alternative — one shared React Email package consumed by both — crosses a module-format boundary. The backend can only consume **CJS** (ADR-0012), while the storefront is ESM. A shared TSX package would have to be dual-emitted from `vp pack` and stay correct in both formats, and cross-format shared packages are exactly the class of thing that produced the hardest-to-diagnose failure we hit during evaluation.

Only **pure-TypeScript design tokens** are shared — colours, type scale, spacing. Those are format-agnostic and are what actually makes the emails look like one brand. The markup is not shared.

## Consequences

Some structural duplication between the two template sets. Accepted: four templates is not enough duplication to justify the risk.

We also rejected routing better-auth's email through Medusa's notification module. It would make sign-up depend on the commerce backend being reachable, which is a bad coupling for the one email that must always send.

Development uses Medusa's local provider, which logs to the terminal, so nothing sends by accident.
