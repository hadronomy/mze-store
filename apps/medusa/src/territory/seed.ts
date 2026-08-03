import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createLocationFulfillmentSetWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createServiceZonesWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  CANARIAS_PROVINCES,
  PENINSULAR_PROVINCES,
  PENINSULAR_VAT,
  PROVINCE_TAX_REGIMES,
  SPAIN,
} from "./spain";

/** What the seed leaves behind, for a caller that has to talk to it. */
export type SeededTerritory = {
  regionId: string;
  salesChannelId: string;
  shippingProfileId: string;
  publishableKey: string;
  productId: string;
};

/**
 * The probe Variant's price, tax exclusive, in EUR.
 *
 * A round hundred so both regimes land on exact cents — 121,00 € against
 * 107,00 € — and a wrong rate is visible at a glance rather than buried in a
 * rounding argument.
 */
export const PROBE_PRICE = 100;

const CURRENCY = "eur";

/**
 * The Region carries payment providers, and a Region with none cannot check
 * out. Stripe registration is its own piece of work; until it lands, the
 * system provider keeps the Region valid.
 */
const SYSTEM_PAYMENT_PROVIDER = "pp_system_default";

/**
 * Medusa's built-in tax provider — the one that reads the rates below rather
 * than calling out to a tax service. A Tax Region carries either a parent or a
 * provider and never both, so this belongs on the country-level region alone.
 */
const SYSTEM_TAX_PROVIDER = "tp_system";

const REGION_NAME = "Spain";
const SALES_CHANNEL_NAME = "Default Sales Channel";
const STOCK_LOCATION_NAME = "Canarias";
const FULFILLMENT_SET_NAME = "Shipping";
const SHIPPING_PROFILE_NAME = "Default";
const PUBLISHABLE_KEY_TITLE = "Storefront";
const PROBE_PRODUCT_HANDLE = "tax-model-probe";
const PROBE_OPTION = { title: "Size", value: "One size" };
const SEEDED_BY = "seed";

/**
 * The two Service Zones, each naming its Provinces. A Service Zone scoped to
 * the country would cover both and leave Canarian shipping unable to differ.
 */
const SERVICE_ZONES = [
  { name: "Peninsula and Baleares", provinces: Object.keys(PENINSULAR_PROVINCES) },
  { name: "Canarias", provinces: Object.keys(CANARIAS_PROVINCES) },
];

/**
 * Put the Spanish territory model in the database, and a Variant to prove it
 * against.
 *
 * Idempotent by identity, not by a marker: every piece is looked up by
 * something stable — the Region by the country it carries, a Tax Region by its
 * Province, a Service Zone by name — and created only when it is missing. So a
 * second run adds nothing, and a run against a half-seeded database fills the
 * gaps rather than duplicating what is there.
 *
 * It creates; it does not correct. A Region or a rate an Operator has since
 * changed in the admin is left as they left it, which is why nothing here is
 * safe to treat as an enforcement of the model — only as its starting point.
 */
export async function seedSpanishTerritory(container: MedusaContainer): Promise<SeededTerritory> {
  const salesChannelId = await ensureSalesChannel(container);
  const regionId = await ensureRegion(container);
  await ensureTaxRegions(container);

  const stockLocationId = await ensureStockLocation(container, salesChannelId);
  await ensureServiceZones(container, stockLocationId);

  const shippingProfileId = await ensureShippingProfile(container);
  const productId = await ensureProbeProduct(container, { salesChannelId, shippingProfileId });
  const publishableKey = await ensurePublishableKey(container, salesChannelId);

  await ensureStoreDefaults(container, { salesChannelId, regionId });

  return { regionId, salesChannelId, shippingProfileId, publishableKey, productId };
}

const queryOf = (container: MedusaContainer) => container.resolve(ContainerRegistrationKeys.QUERY);

async function ensureSalesChannel(container: MedusaContainer): Promise<string> {
  const query = queryOf(container);

  // Medusa creates a Store and a default Sales Channel on first boot. Taking
  // that one keeps the seed from adding a second channel the Store ignores.
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["default_sales_channel_id"],
  });

  const existing = stores[0]?.default_sales_channel_id;
  if (existing) {
    return existing;
  }

  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id"],
    filters: { name: SALES_CHANNEL_NAME },
  });

  if (channels.length) {
    return channels[0].id;
  }

  const { result } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: SALES_CHANNEL_NAME }] },
  });

  return result[0]!.id;
}

async function ensureRegion(container: MedusaContainer): Promise<string> {
  const query = queryOf(container);

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "countries.iso_2"],
  });

  // Keyed on the country, not the name: a country belongs to exactly one
  // Region, so this is what "exactly one Region for Spain" actually means.
  const spanish = regions.find((region) =>
    region.countries?.some((country: { iso_2: string }) => country.iso_2 === SPAIN),
  );

  if (spanish) {
    return spanish.id;
  }

  const { result } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: REGION_NAME,
          currency_code: CURRENCY,
          countries: [SPAIN],
          payment_providers: [SYSTEM_PAYMENT_PROVIDER],
          // Stated rather than left to the default. With this off the Store API
          // returns a bare price and computes no tax at all, which is the one
          // thing the whole Province model is here to do.
          automatic_taxes: true,
        },
      ],
    },
  });

  return result[0]!.id;
}

async function ensureTaxRegions(container: MedusaContainer): Promise<void> {
  const query = queryOf(container);

  const { data: taxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "province_code"],
    filters: { country_code: SPAIN },
  });

  // The country-level Tax Region is not one entry among several: without a
  // parent region for `es`, Medusa returns no tax lines for any Spanish
  // address, Province or not. It also carries peninsular VAT as the default
  // every unnamed Province falls through to.
  let parent = taxRegions.find((region) => region.province_code === null);

  if (!parent) {
    const { result } = await createTaxRegionsWorkflow(container).run({
      input: [
        {
          country_code: SPAIN,
          provider_id: SYSTEM_TAX_PROVIDER,
          default_tax_rate: { ...PENINSULAR_VAT },
          created_by: SEEDED_BY,
        },
      ],
    });

    parent = result[0];
  }

  const missing = PROVINCE_TAX_REGIMES.flatMap((regime) =>
    Object.keys(regime.provinces)
      .filter((province) => !taxRegions.some((region) => region.province_code === province))
      .map((province) => ({
        country_code: SPAIN,
        province_code: province,
        parent_id: parent.id,
        default_tax_rate: { name: regime.name, code: regime.code, rate: regime.rate },
        created_by: SEEDED_BY,
      })),
  );

  if (!missing.length) {
    return;
  }

  await createTaxRegionsWorkflow(container).run({ input: missing });
}

const STOCK_LOCATION_FIELDS = [
  "id",
  "sales_channels.id",
  "fulfillment_sets.id",
  "fulfillment_sets.name",
  "fulfillment_sets.service_zones.id",
  "fulfillment_sets.service_zones.name",
];

const findStockLocation = async (container: MedusaContainer, filters: Record<string, string>) => {
  const { data } = await queryOf(container).graph({
    entity: "stock_location",
    fields: STOCK_LOCATION_FIELDS,
    filters,
  });

  return data[0];
};

async function ensureStockLocation(
  container: MedusaContainer,
  salesChannelId: string,
): Promise<string> {
  let location = await findStockLocation(container, { name: STOCK_LOCATION_NAME });

  if (!location) {
    // No address: the shop's own is an Operator's to enter, and shipping
    // resolves off the Service Zones rather than off this.
    await createStockLocationsWorkflow(container).run({
      input: { locations: [{ name: STOCK_LOCATION_NAME }] },
    });

    location = await findStockLocation(container, { name: STOCK_LOCATION_NAME });
  }

  if (!location.sales_channels?.some((channel: { id: string }) => channel.id === salesChannelId)) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: location.id, add: [salesChannelId] },
    });
  }

  return location.id;
}

async function ensureServiceZones(
  container: MedusaContainer,
  stockLocationId: string,
): Promise<void> {
  let location = await findStockLocation(container, { id: stockLocationId });

  let fulfillmentSet = location.fulfillment_sets?.find(
    (set: { name: string }) => set.name === FULFILLMENT_SET_NAME,
  );

  // Service Zones hang off a fulfillment set, and a fulfillment set an Operator
  // can find hangs off a stock location. Neither is interesting in itself; both
  // are what it takes for the two zones below to exist and be editable.
  if (!fulfillmentSet) {
    await createLocationFulfillmentSetWorkflow(container).run({
      input: {
        location_id: stockLocationId,
        fulfillment_set_data: { name: FULFILLMENT_SET_NAME, type: "shipping" },
      },
    });

    location = await findStockLocation(container, { id: stockLocationId });
    fulfillmentSet = location.fulfillment_sets.find(
      (set: { name: string }) => set.name === FULFILLMENT_SET_NAME,
    );
  }

  const missing = SERVICE_ZONES.filter(
    (zone) =>
      !fulfillmentSet.service_zones?.some(
        (existing: { name: string }) => existing.name === zone.name,
      ),
  );

  if (!missing.length) {
    return;
  }

  await createServiceZonesWorkflow(container).run({
    input: {
      data: missing.map((zone) => ({
        name: zone.name,
        fulfillment_set_id: fulfillmentSet.id,
        geo_zones: zone.provinces.map((province) => ({
          type: "province" as const,
          country_code: SPAIN,
          province_code: province,
        })),
      })),
    },
  });
}

async function ensureShippingProfile(container: MedusaContainer): Promise<string> {
  const query = queryOf(container);

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
    filters: { name: SHIPPING_PROFILE_NAME },
  });

  if (profiles.length) {
    return profiles[0].id;
  }

  const { result } = await createShippingProfilesWorkflow(container).run({
    input: { data: [{ name: SHIPPING_PROFILE_NAME, type: "default" }] },
  });

  return result[0]!.id;
}

async function ensureProbeProduct(
  container: MedusaContainer,
  links: { salesChannelId: string; shippingProfileId: string },
): Promise<string> {
  const query = queryOf(container);

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { handle: PROBE_PRODUCT_HANDLE },
  });

  if (products.length) {
    return products[0].id;
  }

  const { result } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Tax model probe",
          handle: PROBE_PRODUCT_HANDLE,
          description:
            "A stand-in the territory model is asserted against, priced at a round hundred so " +
            "the two regimes are legible at a glance.",
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: links.shippingProfileId,
          sales_channels: [{ id: links.salesChannelId }],
          options: [{ title: PROBE_OPTION.title, values: [PROBE_OPTION.value] }],
          variants: [
            {
              title: PROBE_OPTION.value,
              sku: "TAX-MODEL-PROBE",
              // Nothing is sold from this Variant, and stock arrives from the
              // ERP rather than from a seed.
              manage_inventory: false,
              options: { [PROBE_OPTION.title]: PROBE_OPTION.value },
              // Stored tax exclusive: one price, and the Province decides what
              // a Shopper is shown on top of it.
              prices: [{ amount: PROBE_PRICE, currency_code: CURRENCY }],
            },
          ],
        },
      ],
    },
  });

  return result[0]!.id;
}

async function ensurePublishableKey(
  container: MedusaContainer,
  salesChannelId: string,
): Promise<string> {
  const query = queryOf(container);

  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["id", "token", "sales_channels.id"],
    filters: { title: PUBLISHABLE_KEY_TITLE, type: "publishable" },
  });

  let key = keys[0];

  if (!key) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [{ type: "publishable", title: PUBLISHABLE_KEY_TITLE, created_by: SEEDED_BY }],
      },
    });

    key = { ...result[0], sales_channels: [] };
  }

  if (!key.sales_channels?.some((channel: { id: string }) => channel.id === salesChannelId)) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: key.id, add: [salesChannelId] },
    });
  }

  return key.token;
}

async function ensureStoreDefaults(
  container: MedusaContainer,
  defaults: { salesChannelId: string; regionId: string },
): Promise<void> {
  const query = queryOf(container);

  const { data: stores } = await query.graph({
    entity: "store",
    fields: [
      "id",
      "default_sales_channel_id",
      "default_region_id",
      "supported_currencies.currency_code",
    ],
  });

  const store = stores[0];
  const currencies = store.supported_currencies ?? [];
  const update: Record<string, unknown> = {};

  // EUR has to be a supported currency before an Operator can price a Variant
  // in it at all. Appended rather than assigned: a currency somebody added in
  // the admin is theirs, not the seed's to drop.
  if (
    !currencies.some((currency: { currency_code: string }) => currency.currency_code === CURRENCY)
  ) {
    update.supported_currencies = [
      ...currencies.map((currency: { currency_code: string }) => ({
        currency_code: currency.currency_code,
      })),
      { currency_code: CURRENCY, is_default: !currencies.length },
    ];
  }

  if (!store.default_sales_channel_id) {
    update.default_sales_channel_id = defaults.salesChannelId;
  }

  // What lets the Store API resolve a price when a request arrives with no
  // region_id — which is every request the storefront makes before a Shopper
  // has picked anything.
  if (!store.default_region_id) {
    update.default_region_id = defaults.regionId;
  }

  if (!Object.keys(update).length) {
    return;
  }

  await updateStoresWorkflow(container).run({
    input: { selector: { id: store.id }, update },
  });
}
