# Canarias is modelled as a Province, not a Region

Selling from the Canary Islands into peninsular Spain and the EU spans three tax treatments: IGIC in the Canaries, VAT on the peninsula, destination VAT across the EU. The obvious move is three Regions. It is not available.

Canarias and the peninsula share country code `ES`, and a country belongs to exactly one Region. More to the point, the two things a Region exists to vary — currency and payment methods — are identical across all three. What actually differs is tax and shipping, and both resolve at Province granularity: tax regions and geo zones each carry an ISO 3166-2 `province_code`.

So: Region for currency and payment, Tax Region for rates, Service Zone for shipping. Three orthogonal concepts, varying independently.

## Consequences

- The country-code prefix in URLs distinguishes ES from FR from DE. It **cannot** encode Canarias versus peninsula, and no URL scheme can.
- EU law requires consumer prices to include tax. At 21% VAT against roughly 7% IGIC, the same Variant must display a different price to a Madrid Shopper and a Las Palmas Shopper — **before either has entered an address**. Province must therefore be resolved at first paint. Medusa's product queries accept `country_code` and `province` for exactly this.
- Province is guessed by geo-IP, defaults to Canarias when the guess fails, and is corrected at checkout. Because the default is the home market, the failure case is a peninsula Shopper seeing a price that _rises_ at checkout — the worse direction. The Province control stays visible rather than buried so a wrong guess is cheap to fix.
- Ceuta and Melilla use IPSI, a fourth regime under provinces `es-ce` and `es-ml`. Out of scope today; the model already accommodates it.
