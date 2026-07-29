# Provisioning and Claim are one act, behind one route

Binding an Account to a Customer resolves an existing Customer or creates one. Those are two branches of a single operation, not two features — and the whole thing sits behind one custom route, `POST /store/auth/session`.

## Why one act

`createCustomerAccountWorkflow` in core always creates:

```js
createCustomersWorkflow.runAsStep({ … })              // has_account: !!authIdentityId
setAuthAppMetadataStep({ authIdentityId, actorType: "customer", value: customer.id })
```

That last step is what makes `actor_id` appear in later tokens. There is no resolve-or-adopt branch anywhere in core, so the Claim needs custom work regardless.

Treating the Claim as a separate post-purchase feature would mean two mechanisms that both bind Accounts to Customers, racing on the same `app_metadata`. Modelling it as the _resolve branch_ of Provisioning leaves one mechanism with two paths, and one place where binding happens.

## Why one route

Medusa's stock flow is two calls — `/auth/customer/better-auth`, then `/store/customers` — because it has a two-phase identity model: after authenticating you hold an `auth_identity_id` but no `actor_id`, and are authenticated-but-unable-to-act.

That is Medusa's internal concern. Exposing it means the storefront must understand the two-phase model, handle a token that verifies but cannot act, and orchestrate a second call. One route that verifies, provisions, and returns a token already carrying `actor_id` keeps that inside the backend where it belongs.

This is a deliberate deviation from Medusa convention. A reader expecting the stock flow should find this note rather than assume an oversight.

## When a Claim fires

On better-auth's `afterEmailVerification`, which fires the instant `emailVerified` becomes true — exactly when a Claim becomes permissible under ADR-0008.

This also covers a case a sign-in check would miss: a Shopper signs up as one address, later changes to another and verifies it. Guest Orders under the new address are claimed with no special path.

## Consequences

- Claims are a subscriber on verification, not a prompt on the confirmation page.
- The workflow must be idempotent. Verification can fire more than once, and adopting an already-adopted Customer must be a no-op rather than a second binding.
- Compensation matters: a Customer created without its `app_metadata` binding is an orphan that will never be reachable. The create-and-bind pair must roll back together.
