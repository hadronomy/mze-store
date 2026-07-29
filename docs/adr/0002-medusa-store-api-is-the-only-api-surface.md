# Medusa's Store API is the only API surface

The project was scaffolded with an oRPC layer in `packages/api`. We removed it. Medusa's Store API plus its JS SDK already constitutes a fully typed API, and Medusa's central architectural rule is that every mutation flows through a workflow.

An oRPC layer in front of Medusa creates a second API surface that bypasses the workflow engine, the module container, and the publishable-key and CORS middleware. That bypass is not theoretical — it is the path of least resistance for anyone adding an endpoint in a hurry.

## Consequences

Custom endpoints live in the Medusa backend under `src/api/store/*`, where they inherit the workflow engine and middleware by default. Anything the storefront needs that Medusa doesn't expose is a Medusa API route, not a parallel service.

This is worth re-reading before anyone reintroduces a general-purpose RPC layer for "app concerns." Nothing in scope today qualifies.
