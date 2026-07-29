# Redis is present from the first deploy

Caching, event bus, workflow engine, and locking all run on Redis from day one, despite the store launching small.

Redis reads as a scaling concern, which is why it gets deferred. Here it is a correctness concern:

- **Locking.** Without a distributed lock provider, concurrent inventory reservations race. That is overselling — taking money for stock that isn't there. In-memory locking is correct while there is exactly one instance, so this fails silently the moment a second one starts.
- **Workflow engine.** In-memory means workflow state is lost on restart. Stripe's `PaymentElement` is worth using precisely because `automaticPaymentMethods` enables asynchronous methods like iDEAL and Bancontact, whose confirmation webhook arrives later — possibly after a deploy. A restart in that window is "charged, no order."
- **Event bus.** The local bus is in-process. A crash between order placement and the confirmation email loses the email with no trace.

The cost is one container locally and a small managed instance in production. That is not a price worth deferring against those failure modes.

## Consequences

Development and production run the same module configuration, which removes a common class of deployment surprise.
