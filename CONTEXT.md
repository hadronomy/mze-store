# MZE Store

An online storefront for a physical shop selling from the Canary Islands into Spain and the wider EU. Commerce runs on Medusa; the shop floor runs on Odoo.

Three separate systems in this project each ship a table called `user`, meaning three different things. The vocabulary below exists mostly to stop that ambiguity from leaking into conversation and code.

## Language

### People

**Shopper**:
A human browsing or buying. Deliberately informal — used when the distinction between Customer and Account doesn't matter yet.

**Customer**:
The commerce record of a buyer, with or without a sign-in identity. Every order has exactly one.
_Avoid_: client, buyer, account, user

**Account**:
The identity a Shopper signs in with. Owns credentials, verification state, and sessions. A Customer may exist without one.
_Avoid_: user, login, profile, membership

**Operator**:
Staff who administer the store through the admin dashboard. Never a Shopper.
_Avoid_: user, admin user, staff, employee

### Buying

**Cart**:
A Shopper's in-progress selection. Mutable, expires, has no financial meaning.

**Order**:
A completed purchase. Immutable once placed.
_Avoid_: purchase, transaction, sale

**Guest Order**:
An Order placed without an Account, identified only by email.

**Provisioning**:
Binding an Account to the Customer it will act as, on first sign-in. Resolves an existing Customer or creates one; both paths end with the Account able to act.

**Claim**:
The resolve branch of Provisioning — adopting an existing Guest Order Customer instead of creating a new one, permitted only when the Account's email is verified. Not a separate feature from Provisioning; the same act, taking the other path.
_Avoid_: merge, link, migration

**Token Exchange**:
Trading proof of an Account's identity for a token that can act as its Customer. The Account proves; commerce alone signs.
_Avoid_: token swap, minting, login, handoff

**Variant**:
The specific purchasable thing a Shopper adds to a Cart — a size, a colour, a configuration. Stock and price attach here, never to the Product.
_Avoid_: SKU (the SKU is the _code identifying_ a Variant, not the Variant)

**Product**:
The presentation grouping a Shopper browses. Holds description, imagery, and options. Cannot itself be bought.

### Territory

Three concepts that all sound like "where the Shopper is" and are routinely confused. They vary independently.

**Region**:
Which currency a Shopper pays in and which payment methods they see, scoped to a set of countries. A country belongs to exactly one.
_Avoid_: market, territory, locale, zone

**Tax Region**:
A rule set determining what tax applies, resolvable down to a single Province. Independent of Region — one Region can contain several.
_Avoid_: tax zone, VAT zone

**Service Zone**:
The geographic area a given set of shipping options serves, resolvable down to a single Province. Independent of both Region and Tax Region.
_Avoid_: shipping zone, delivery area

**Province**:
An ISO 3166-2 subdivision. The finest granularity at which tax and shipping differ, and the reason Canarias cannot be modelled as its own Region — it shares country code `ES` with the peninsula.

### Invoicing

Two verbs that sound interchangeable and are not. Conflating them is how a storefront accidentally acquires a fiscal obligation.

**Issue**:
Creating the legal fiscal record for a sale — assigning its series number, chaining its hash, declaring it to the tax authority. Only the ERP issues.
_Avoid_: generate, create, raise

**Deliver**:
Putting an already-issued Invoice in front of the Shopper — emailing it, listing it in their account, serving a re-download. Only commerce delivers.
_Avoid_: send, issue, provide

**Invoice**:
The issued fiscal document for a sale. Distinct from an Order: an Order is the operational record of what was bought, an Invoice is the accounting record of what was charged. They have different owners and different retention.

**Order Confirmation**:
The message a Shopper receives on checkout. Not a fiscal document and never an Invoice — it arrives before one exists.

### Erasure

**Erasure**:
Removing a Shopper's personal data on request. Not a deletion — the Account goes, the Customer is scrubbed to a tombstone, and Orders remain as financial records.
_Avoid_: deletion, removal, GDPR delete, purge

**Erasure Request**:
A tracked, durable record that an Erasure was asked for and how far it got. Exists because Erasure crosses two systems under a legal deadline, so it needs a retry anchor and an audit trail — not merely an event.

**Tombstone**:
A Customer whose personal fields have been scrubbed but whose row survives, so Orders that reference it stay intact.

**Retention Window**:
The period past which an Order's personal data may no longer be kept. Set by accounting and invoicing law, not by preference.

### Stock

**Sync Record**:
A tracked, durable record of an Order's push to the ERP and how far it got. Exists for the same reason as an Erasure Request — a crossing between systems with financial consequences needs a retry anchor and something an Operator can look at, not an event that vanishes.

**Online Allocation**:
The portion of true stock that the ERP publishes as sellable online. Commerce reserves against this and never against the shop floor.
_Avoid_: buffer, quota, available stock

**Reservation**:
A hold placed on Online Allocation while a Cart progresses toward becoming an Order.
