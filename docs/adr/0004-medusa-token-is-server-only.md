# The Medusa token never reaches the browser

All credentialed Medusa calls run server-side from the storefront. The Medusa JWT is minted from the better-auth session, held in an HttpOnly cookie, and never sent to the browser. Public catalog reads carry no credentials and still go direct, so they stay cacheable.

Medusa's official Next.js starter does this (`httpOnly`, `sameSite: strict`, behind `server-only`). The TanStack starter we otherwise follow does the opposite, keeping the token in `localStorage`. We follow the stricter one: a customer JWT readable by JavaScript means any XSS — a compromised analytics snippet, a bad transitive dependency — exfiltrates sessions, which would waste the HttpOnly posture that ADR-0003's bridge exists to provide. The weakest credential sets the security level.

## Consequences

- Cart and checkout mutations cost an extra hop: browser → storefront server → Medusa.
- Only one credential ever exists in the browser, so there is no two-token synchronisation and no refresh race.
- The SDK package splits in two: a server half that holds the token, and a client half that calls server functions. This split is load-bearing, not stylistic.

### Bounding revocation

Medusa's JWTs are stateless and cannot be revoked, but better-auth sessions can be. Left alone, signing out would leave a working Medusa token for up to its full lifetime.

We set the Medusa token to expire in roughly fifteen minutes and cache it in-process, keyed by the better-auth session token, evicting on sign-out. Explicit sign-out is immediate; any other revocation is bounded by the expiry. A cache miss is harmless — it just mints a fresh token — so this needs no shared cache and does not constrain instance count.
