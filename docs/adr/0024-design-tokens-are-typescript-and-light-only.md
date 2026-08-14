# Design tokens are TypeScript, and the store is light-only

The design gate blocks phase 3. Once component structure exists it acquires inertia, and design applied afterwards becomes a reskin. This record is what cleared the gate.

MZE is a **multi-brand retailer**, not a house brand. The catalogue carries Esential Aroms, Organic India, Khadi, Dr. Hauschka, Maybeez, and Brushboo. Nothing below makes sense without that: the shop does not control its own product photography, and forty supplier packagings already carry all the colour on the page.

## Decision

`@mze-store/design-tokens` is the one source. It is pure TypeScript, dual-emitted, and consumed by three **Surfaces**: the Storefront, transactional email, and the Invoice. The Medusa admin is out of scope — Medusa UI is its own design system and Operators are not Shoppers.

### TypeScript generates the CSS, never the reverse

Email can read neither a custom property nor an `oklch()` value, so it needs colours resolved to sRGB. Only TypeScript can hold both forms next to each other. Each colour is authored as an `oklch`/`hex` pair, and a test proves they describe the same colour, so forgetting one half fails the build instead of shipping a green email beside a grey storefront.

The build emits `dist/theme.css` from the packed ESM output. That file carries **layer one only** — the `--mze-*` brand primitives. The mapping onto the component library's `--primary`/`--muted` contract is a design judgement, so it stays hand-written in `packages/ui/src/styles/globals.css`. Generation for data, authorship for decisions.

Two layers, not one, because `--popover-foreground` is meaningless on a fiscal document. What the three Surfaces genuinely share is `paper`, `ink`, `line`, and `leaf`.

### Colour: nine primitives, no generated ramp

Neutrals sit at hue 92 with very low chroma — a warm paper ground. The logo's second colour (`#70777D`) is deliberately unused: it is cool, and a cool grey fights warm paper. It belongs to the logo lockup alone.

The green is the brand anchor, not the button fill. `leaf` is the logo value exactly, and it measures 4.07:1 on paper — enough for large text and non-text, not enough for body copy. That is the whole reason there are two greens rather than one: `leafDeep` at 7.77:1 carries anything a Shopper has to read. Primary actions are `ink`. The green is spent where it means something — the mark, in-stock state, the active facet, the focus ring.

**Contrast is checked against every ground, not just against paper.** Building the Paper specimen exposed the trap: `inkMuted` cleared AA on the page and failed on `paperRaised` at 4.44:1, so the same caption passed or failed depending on which surface it landed on. Quoting one ratio "on paper" hides that. `inkMuted` was darkened until it clears 4.5:1 on the darkest ground, and the test now walks every text colour against every ground colour, so no future edit can reintroduce a pair that only works in one place.

`--chart-1` through `--chart-5` are deleted. A storefront has no charts, and the stock values were the default blue ramp.

### The chrome steps back; the signature is placed, not sprayed

The signature artifact extends the logo's own line language: a botanical drawing per plant, at the mark's stroke weight, one for each essential oil. It is derived from the real asset instead of invented, and no competitor can paste it in.

It appears only where the shop owns the frame — the homepage, category headers, and the essential-oil product pages. It does **not** appear on product cards in a grid, because behind twenty-four supplier packagings a drawing competes rather than signs.

`productGround` is the counterweight and the highest-leverage token here. Suppliers ship images on white, on transparent, and on lifestyle backgrounds, in whatever crop they shot. One imposed ground, one aspect, one padding, applied to every image with no exception, is what makes forty brands read as one shop. It is also an upload rule for Operators, not only a stylesheet.

### Type: Spectral Light, Inter Variable, and a data register

Spectral Light for display, Inter Variable for everything else. The reference set that matters here runs the same shape — Ritual, The Nue Co, and Susanne Kaufmann all pair a serif display with a quiet neutral sans, and all three sell a botanical or ingredient story.

The display face is set only above `displayMinSize`. A light serif is weak at reading sizes, and the threshold removes the temptation to use it there; Inter carries every size beneath it from one variable file.

Geist Mono is a third family, and it is scoped hard: dosage, net volume, capsule count, INCI, SKU. Never navigation, labels, captions, or the copyright line. A mono as house voice is a tell; a mono as a data register is why Typology, Dieux, and Diptyque all carry one. MZE sells 90-capsule bottles and 10ml oils — the register is real.

Family stacks are per-Surface. The Storefront and the Invoice share one, because the Invoice renderer embeds and subsets the real files (ADR-0023). Email names no self-hosted family at all, because no webfont survives the client matrix, and a test enforces that.

**The display face must be one the shop may self-host.** This is a hard constraint, not a preference, and it eliminated the first choice. Sentient fits the brief well, but Fontshare's Free Font EULA §02 forbids uploading the files "in a public server" and forbids transmitting them "over the Internet in font serving or for font replacement"; it points at Fontshare's own API as the sanctioned web route instead. A CDN-only font cannot work here, because ADR-0023 has the Invoice renderer embedding font bytes into the PDF — it needs the file, not a stylesheet link. The same clause rules out Pally, Gambarino, and Tanker, which are Fontshare faces too.

Spectral replaced it. Production Type released it under the SIL Open Font License, which grants self-hosting and PDF embedding outright, and it carries more voice than a workhorse serif while staying calm enough to sit on a fiscal document. It is static, so weight 300 and its italic are two files — still less than a variable pair would cost for a design that uses one weight.

All three families come from Fontsource, whose whole purpose is self-hosting. Only the Latin subset ships; the shop's five languages never leave Latin-1.

### Geometry: the corner is a superellipse, not a rounded rectangle

`corner-shape: squircle` — that is `superellipse(2)` — applied once in a base rule, with `--radius` at `0.625rem`. This is the system's one piece of bespoke geometry, and it is why the radius is generous rather than tight: a superellipse needs room to read as one, and at 4px it is indistinguishable from ordinary rounding.

One rule covers everything, because the property degrades in two directions at the same time. A browser without `corner-shape` falls back to a plain rounded corner, and MDN is explicit that the property has no effect wherever `border-radius` resolves to `0`. Chromium-only today, around 65% of users, not Baseline, and none of that matters when the fallback is the thing you would otherwise have shipped.

The one exception is circles: a superellipse at full radius is not a circle. `.rounded-full` resets to `round`, and a class beats `*` on specificity, so that holds without touching a single component.

This forced a change to the primitives. The `base-lyra` style is square by design — it carried `rounded-none` 39 times, so `--radius` themed nothing at all and the token was dead. Those are now `rounded-md` for controls and `rounded-lg` for surfaces. Four deliberate resets survive: a card's header, footer, and inner images, which the card clips itself through `overflow-hidden`, and the bubble variant that strips its content's radius.

### Compatible with Tailwind v4 and shadcn by construction

`@theme inline` with `var()` is what both Tailwind's and shadcn's own documentation prescribe for theme variables that reference other variables, so the two-layer structure is upstream-canonical rather than a local invention. `shadcn/tailwind.css` defines no colour or radius token at all, so nothing collides.

Three things follow from wanting the CLI to stay usable:

**The full canonical contract is defined, including tokens nothing uses.** `--destructive-foreground`, `--chart-1..5`, and the eight `--sidebar-*` were previously deleted as speculative. That was right for minimalism and wrong here: `shadcn add chart` or `add sidebar` produced components pointing at variables that did not exist. They are defined now and mapped to the brand, so a registry component drops in without editing this file and without arriving in stock colours. The chart ramp is the one place a raw `oklch()` is permitted, because those five categorical colours have no brand primitive to point at.

**The radius scale matches upstream's derivation exactly** — `--radius-lg: var(--radius)`, with `md` and `sm` multiplied down. The earlier additive scale put `--radius-md` on the base, so any registry component written against `rounded-lg` landed two pixels off what its author meant.

**The brand layer generates utilities of its own.** `bg-leaf`, `text-ink`, `bg-product-ground` exist alongside `bg-primary`. Both vocabularies are needed: the shadcn names describe component roles, and `product-ground` has no equivalent among them.

The CLI writes CSS variables directly into `globals.css`, which is deliberate — the file keeps the shape the CLI recognises. The risk is that a CLI-written literal colour survives there, and the Storefront and the email templates quietly stop sharing a source. `test/globals-css.test.ts` fails the build on any hex, `rgb()`, or `hsl()` literal, on a raw `oklch()` outside the chart ramp, and on a reintroduced `.dark` block.

`components.json` pins every preset dimension the CLI would otherwise default. One cannot be expressed: Spectral is absent from the 26 faces in `PRESET_FONTS`, so `fontHeading` stays `inherit` and the display family is wired by hand. That gap is the reason the guard test exists rather than trust.

### Light-only

There is no `.dark` block and no dark palette. It roughly doubles the palette work and every contrast check, and an apothecary reading as paper and daylight has a reason to be light.

This has one sharp edge worth stating plainly. Deleting the `@custom-variant dark` declaration is **not** part of going light-only — it is a bug. Without it, Tailwind falls back to its default `dark:` variant, `prefers-color-scheme: dark`, and the `dark:` utilities that component primitives still ship fire against a light palette for any Shopper whose system is dark. The declaration stays, pinned to a class nothing ever sets, until the last `dark:` utility is gone from `packages/ui/src/components`.

## Rejected alternatives

- **One token layer.** Forces component vocabulary onto an Invoice and an email.
- **CSS as the source, TypeScript mirroring it.** Guaranteed drift — the exact failure ADR-0011 created shared tokens to prevent.
- **A generated colour ramp.** Nine values cover the store. A ramp would be speculative configuration.
- **A geometric light sans as the display face**, matching the wordmark. It is the most over-shipped wellness register there is. The wordmark is an artifact; it is not the type system.
- **Serving the display face from Fontshare's CDN.** It is the licence-compliant route for the Storefront and it solves nothing for the Invoice, which needs bytes. It would also put a third-party request on the critical render path.
- **Going fully quiet**, as Credo Beauty and Space NK do. Correct about restraint, but a signature placed carefully costs nothing and a shop with none is the boring failure.
- **Dark mode now.** Additive later if the tokens are right; a rewrite if built speculatively today.

## Consequences

- A fresh clone must build `@mze-store/design-tokens` before the Storefront, because `theme.css` is generated. The `dev` scripts do this.
- `culori` is a development dependency only. It verifies the colour pairs and never ships.
- All three families are resolved and self-hosted. No font work remains.
- Font licences are a real constraint on this project, not paperwork. Any future family must clear the same two questions before its specimen is even worth looking at: may we self-host it, and may we embed it in a PDF?
- `dark:` utilities inside component primitives are dead weight. Stripping them is phase-3 component work, not gate work.
- Roughly twenty-five botanical drawings are now a real commitment, and they are on the critical path for the catalogue seed.

## Related

- ADR-0011 — email templates are not shared; only tokens are.
- ADR-0012 — the Medusa backend is a `tsc` island, so shared packages must dual-emit.
- ADR-0023 — Takumi renders Invoices from the same CSS.
