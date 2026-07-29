# better-auth owns Shopper identity; Medusa holds a projection

better-auth is the source of record for Accounts. Medusa's auth identity is a downstream projection, reached through a single custom auth module provider that verifies a better-auth JWT against its JWKS endpoint and then retrieves or creates the corresponding Medusa auth identity.

We took this over using Medusa's native `emailpass` because better-auth brings social sign-in, passkeys, magic links, and session management that Medusa's auth module does not, and because identity is not a commerce-scoped concern.

## Where the seam falls

"Source of record for identity" is narrower than "source of record for the Shopper". The two systems hold overlapping fields, and ownership splits between them:

- **Email is identity.** The Customer's email is a read-only projection of the verified Account email, refreshed on every exchange. It cannot be allowed to drift: the Claim rule keys on it, and a stale copy could match a Claim to the wrong person.
- **Name, phone, and addresses are profile.** They belong to the Customer and are never overwritten by the Account. The name on an invoice is not the name on a login, and renaming an account must not silently rewrite a shipping label.
- **Past Orders are neither.** `order.email` is snapshotted at placement, so history stays truthful with no sync at all.

Admin extensions close the gap this would otherwise leave — an Operator editing "the email" in Medusa admin writes through to the Account, so the projection stays invisible to them. Operator edits force re-verification (ADR-0008).

## Consequences

- `entity_id` on the Medusa auth identity is the better-auth user id, **never** the email. Email is mutable; keying on it means an address change silently forks a Shopper into a second Customer and orphans their order history. Email lives in metadata and is refreshed on each sign-in.
- **Operators are out of scope.** Medusa admin users stay on native `emailpass`. Bridging the admin actor is real work for a surface only staff touch.
- The bridge is not on the critical path to revenue. Guest checkout means a Shopper can buy without ever authenticating, so this can slip without blocking sales.
- We now maintain a bridge indefinitely. Medusa 2.18 shipped native MFA and verification providers, narrowing the capability gap that justifies it — worth revisiting if the social and passkey features go unused.
