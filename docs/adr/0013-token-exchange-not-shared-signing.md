# Commerce signs its own tokens; the Account only proves identity

better-auth proves who a Shopper is. Medusa mints the token that acts as their Customer. The two systems never share a signing key.

This is recorded because the alternative is genuinely more elegant and someone will propose it.

## The rejected alternative

Medusa's bearer verification is, in full:

```js
const verified = verify(token, jwtPublicKey ?? jwtSecret, options)
if (isActorTypePermitted(actorTypes, verified.actor_type)) {
  return verified   // the decoded payload *is* the auth context
}
```

There is no database lookup. Medusa checks the signature, reads `actor_type` off the token, and trusts the payload wholesale. So if better-auth signed a Medusa-shaped payload with a key whose public half sat in `jwtPublicKey`, Medusa would accept better-auth's tokens directly — no exchange, no mint hop, no cache, no TTL machinery. One token, end to end.

It is the cleaner design on every axis except one.

## Why we rejected it

**The permitted actor list comes from the route; the actor type comes from the token.** Medusa has a single key for every actor type, with no way to scope one to customers. Anything holding that key can mint `actor_type: "user"` — an admin token — for any `actor_id`.

The storefront is the internet-facing process. Handing it commerce's signing authority means a leaked environment variable or an RCE there is silent, total admin compromise of the backend. Under exchange, the same compromise yields only the ability to ask Medusa for customer tokens, which Medusa can refuse, scope, and expire.

Secondarily: `jwtPublicKey` is passed straight to `jsonwebtoken.verify`, which takes a key, not a JWKS URL. Medusa **cannot consume a rotating JWKS**, so shared signing would also force better-auth onto a pinned, non-rotating key pair.

## Consequences

- A mint hop and a token cache exist, and are the price of the trust boundary. ADR-0004 covers their lifecycle.
- The custom auth module provider verifies better-auth's JWT over JWKS, where rotation works normally.
- Re-check on Medusa upgrades: if per-actor-type keys ever land, this decision is worth revisiting, because the shared-signing design is otherwise better.
