# Native Medusa search, no search service yet

The catalog is large and variant-heavy, which normally implies Meilisearch or Algolia on day one. We ship on Medusa's built-in free-text `q` and filter parameters instead.

Medusa covers more than expected natively: `q` over searchable fields, plus filters on category, collection, tag, type, `option_value_id`, and variant identifiers, with ordering and pagination. At hundreds of Variants with sensible indexes, that is fast.

A search service is not free. It is another container, plus a subscriber-driven index pipeline that is a permanent correctness surface — stale indexes, partial reindexes, drift after bulk imports.

## Consequences

What Postgres will not give: typo tolerance, relevance ranking, fast facet counts, synonyms. The trigger to revisit is evidence — poor result quality on the real catalog, or slow facets — not catalog size alone.

Because all querying is isolated behind the SDK package (ADR-0004), swapping the backing store later is a contained change rather than a browse-UI rewrite. Recorded so that "we should add Algolia" gets answered with evidence rather than repeated.
