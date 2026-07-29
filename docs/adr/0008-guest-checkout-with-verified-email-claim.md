# Guest checkout, with Claims gated on verified email

Shoppers buy without an Account. After purchase they are offered one, and creating it attaches their past Guest Orders — a Claim.

A Claim is the resolve branch of Provisioning, and fires on better-auth's `afterEmailVerification` rather than as a post-purchase prompt. See ADR-0014.

Mandatory account creation is among the largest measured causes of checkout abandonment, which a store starting small cannot afford. Post-purchase Claim recovers the retention benefit without gating the sale.

## The rule that makes it safe

**A Claim requires a verified email.** Linking on email match alone means anyone who signs up with a stranger's address inherits their order history, shipping addresses, and purchase record. That is account takeover through the front door, and it is the default behaviour if nobody thinks about it. Mailbox control is the proof of entitlement; better-auth's `emailVerified` is the gate.

Two paths could reopen it, and both are closed deliberately:

- **A Shopper redirecting their own Account.** better-auth's `user.changeEmail` with `sendChangeEmailConfirmation` sends approval to the *current* address, so an address cannot be moved silently.
- **An Operator editing an email in admin.** The admin plugin writes through `internalAdapter.updateUser`, which sets fields directly and does **not** reset `emailVerified`. Left alone, any Operator — or anyone with a stolen admin session — could point an Account at a stranger's address and inherit their history. So Operator-initiated email changes force `emailVerified` to false and send a verification mail. Support can still fix a mistyped signup address; nobody harvests an order history by typing one in.

## Consequences

This pulls transactional email from "later" into required scope — the Claim flow cannot ship safely without a real sender behind better-auth's verification email. Medusa needs one anyway for order confirmations, so it is one dependency rather than two, but it is no longer deferrable.

Every Order therefore has a Customer, but not every Customer has an Account. Code that assumes an authenticated Shopper anywhere in the buying path is wrong.
