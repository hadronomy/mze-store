import type { MedusaContainer, UpdateStoreDTO } from "@medusajs/framework/types";
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
  updateServiceZonesWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  CANARIAS_PROVINCES,
  PENINSULAR_PROVINCES,
  PENINSULAR_VAT,
  PROVINCE_TAX_REGIMES,
  SPAIN,
} from "./spain";

/** The identifiers that a caller needs to use what the seed created. */
export type SeededTerritory = {
  regionId: string;
  salesChannelId: string;
  shippingProfileId: string;
  publishableKey: string;
  productId: string;
};

/**
 * The price of the probe Variant, in EUR and without tax.
 *
 * A round hundred gives an exact result in both regimes: 121,00 € and
 * 107,00 €. A wrong rate is therefore easy to see, and no rounding argument
 * can hide it.
 */
export const PROBE_PRICE = 100;

export const CURRENCY = "eur";

/**
 * A Region carries payment providers, and a Region without one cannot take a
 * payment. Stripe registration is separate work. The system provider keeps
 * this Region valid until Stripe arrives.
 */
const SYSTEM_PAYMENT_PROVIDER = "pp_system_default";

/**
 * The tax provider that Medusa includes. It reads the rates in this project
 * and does not call an external tax service. A Tax Region carries a parent or
 * a provider, never both. Only the country-level Tax Region gets this one.
 */
const SYSTEM_TAX_PROVIDER = "tp_system";

const REGION_NAME = "Spain";
const SALES_CHANNEL_NAME = "Default Sales Channel";
const STOCK_LOCATION_NAME = "Canarias";
const FULFILLMENT_SET_NAME = "Shipping";
const SHIPPING_PROFILE_NAME = "Default";
const PUBLISHABLE_KEY_TITLE = "Storefront";
const PROBE_PRODUCT_HANDLE = "tax-model-probe";
export const PROBE_OPTION = { title: "Size", value: "One size" };
const SEEDED_BY = "seed";

/**
 * The two Service Zones. Each one names its Provinces. A Service Zone scoped
 * to the country covers both, and then Canarian shipping cannot differ from
 * peninsular shipping.
 */
const SERVICE_ZONES = [
  { name: "Peninsula and Baleares", provinces: Object.keys(PENINSULAR_PROVINCES) },
  { name: "Canarias", provinces: Object.keys(CANARIAS_PROVINCES) },
];

/**
 * Creates the Spanish territory model in the database, with a Variant to test
 * it against.
 *
 * The seed is idempotent by identity and not by a marker. It finds each piece
 * by something stable: the Region by the country it carries, a Tax Region by
 * its Province, a Service Zone by its name. It creates a piece only when that
 * piece is absent. A second run therefore creates nothing, and a run against a
 * half-seeded database fills the gaps.
 *
 * The seed creates, but it does not correct. It keeps a Region or a rate that
 * an Operator changed in the admin. The seed is the starting point of the
 * model. It does not enforce the model.
 *
 * A Service Zone is the one exception. The seed adds a Province that the zone
 * does not have yet, because a new tax regime adds Provinces to a zone that
 * already exists. It never removes a Province from a zone.
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

  // Medusa creates a Store and a default Sales Channel on first boot. The seed
  // uses that channel, because the Store ignores any second channel.
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

  if (channels[0]) {
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

  // The lookup uses the country and not the name. A country belongs to exactly
  // one Region. That fact is what "exactly one Region for Spain" means.
  const spanish = regions.find((region) =>
    region.countries?.some((country) => country?.iso_2 === SPAIN),
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
          // Set here and not left to the default. If this flag is off, the
          // Store API returns a price with no tax. Tax is the one thing that
          // this Province model exists to compute.
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

  // The country-level Tax Region is not one entry among many. If no parent
  // region for `es` exists, Medusa returns no tax line for any Spanish address,
  // with or without a Province. This region also carries peninsular VAT, which
  // every Province without a regime uses.
  let parentId = taxRegions.find((region) => region.province_code === null)?.id;

  if (!parentId) {
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

    parentId = result[0]!.id;
  }

  const missing = PROVINCE_TAX_REGIMES.flatMap((regime) =>
    Object.keys(regime.provinces)
      .filter((province) => !taxRegions.some((region) => region.province_code === province))
      .map((province) => ({
        country_code: SPAIN,
        province_code: province,
        parent_id: parentId,
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
  "fulfillment_sets.service_zones.geo_zones.id",
  "fulfillment_sets.service_zones.geo_zones.province_code",
];

/**
 * Finds the stock location, and fails loudly when it is absent.
 *
 * The seed creates the location before it reads it back, so an absent location
 * means the create failed without an error. That is worth a stack trace here
 * and not a `TypeError` three lines later.
 */
const findStockLocation = async (container: MedusaContainer, filters: Record<string, string>) => {
  const { data } = await queryOf(container).graph({
    entity: "stock_location",
    fields: STOCK_LOCATION_FIELDS,
    filters,
  });

  return data[0];
};

const requireStockLocation = async (
  container: MedusaContainer,
  filters: Record<string, string>,
) => {
  const location = await findStockLocation(container, filters);

  if (!location) {
    throw new Error(
      `The seed created the stock location ${STOCK_LOCATION_NAME}, but it cannot find it again.`,
    );
  }

  return location;
};

const provinceGeoZone = (province: string) => ({
  type: "province" as const,
  country_code: SPAIN,
  province_code: province,
});

async function ensureStockLocation(
  container: MedusaContainer,
  salesChannelId: string,
): Promise<string> {
  let location = await findStockLocation(container, { name: STOCK_LOCATION_NAME });

  if (!location) {
    // The location has no address. An Operator enters the address of the shop.
    // Shipping resolves from the Service Zones and not from this location.
    await createStockLocationsWorkflow(container).run({
      input: { locations: [{ name: STOCK_LOCATION_NAME }] },
    });

    location = await requireStockLocation(container, { name: STOCK_LOCATION_NAME });
  }

  if (!location.sales_channels?.some((channel) => channel?.id === salesChannelId)) {
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
  let location = await requireStockLocation(container, { id: stockLocationId });

  const setNamed = (candidate: { name?: string | null } | null) =>
    candidate?.name === FULFILLMENT_SET_NAME;

  let fulfillmentSet = location.fulfillment_sets?.find(setNamed);

  // A Service Zone belongs to a fulfillment set, and a fulfillment set belongs
  // to a stock location. Neither one is interesting on its own. Both exist so
  // that an Operator can find and edit the two zones.
  if (!fulfillmentSet) {
    await createLocationFulfillmentSetWorkflow(container).run({
      input: {
        location_id: stockLocationId,
        fulfillment_set_data: { name: FULFILLMENT_SET_NAME, type: "shipping" },
      },
    });

    location = await requireStockLocation(container, { id: stockLocationId });
    fulfillmentSet = location.fulfillment_sets?.find(setNamed);
  }

  if (!fulfillmentSet) {
    throw new Error(
      `The seed created the fulfillment set ${FULFILLMENT_SET_NAME}, but it cannot find it again.`,
    );
  }

  const fulfillmentSetId = fulfillmentSet.id;
  const existingZones = (fulfillmentSet.service_zones ?? []).filter((zone) => !!zone);

  const newZones = SERVICE_ZONES.filter(
    (zone) => !existingZones.some((existing) => existing.name === zone.name),
  );

  if (newZones.length) {
    await createServiceZonesWorkflow(container).run({
      input: {
        data: newZones.map((zone) => ({
          name: zone.name,
          fulfillment_set_id: fulfillmentSetId,
          geo_zones: zone.provinces.map(provinceGeoZone),
        })),
      },
    });
  }

  // A zone that already exists can still be missing a Province, because a new
  // tax regime adds Provinces to a zone that the seed created before. A match
  // on the name of the zone alone therefore leaves those Provinces with no
  // shipping.
  for (const zone of SERVICE_ZONES) {
    const existing = existingZones.find((candidate) => candidate.name === zone.name);

    if (!existing) {
      continue;
    }

    const geoZones = (existing.geo_zones ?? []).filter((geoZone) => !!geoZone);
    const present = new Set(geoZones.map((geoZone) => geoZone.province_code));
    const absent = zone.provinces.filter((province) => !present.has(province));

    if (!absent.length) {
      continue;
    }

    await updateServiceZonesWorkflow(container).run({
      input: {
        selector: { id: existing.id },
        update: {
          // The update replaces the collection of geo zones. Each geo zone that
          // stays therefore needs its id here. A geo zone that is absent from
          // this list is one that Medusa deletes.
          geo_zones: [
            ...geoZones.map((geoZone) => ({ id: geoZone.id })),
            ...absent.map(provinceGeoZone),
          ],
        },
      },
    });
  }
}

async function ensureShippingProfile(container: MedusaContainer): Promise<string> {
  const query = queryOf(container);

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
    filters: { name: SHIPPING_PROFILE_NAME },
  });

  if (profiles[0]) {
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

  if (products[0]) {
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
              // Nobody sells this Variant, and stock comes from the ERP and not
              // from a seed.
              manage_inventory: false,
              options: { [PROBE_OPTION.title]: PROBE_OPTION.value },
              // Stored without tax. There is one price, and the Province
              // decides the tax that a Shopper sees on top of it.
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

  const existing = keys[0];

  // Only the id, the token, and the linked channels matter here, so the two
  // branches agree on those three and not on a whole entity. The workflow
  // returns a DTO and the query returns a model, and the two do not match.
  const key = existing
    ? {
        id: existing.id,
        token: existing.token,
        salesChannels: (existing.sales_channels ?? []).map((channel) => channel?.id),
      }
    : await createApiKeysWorkflow(container)
        .run({
          input: {
            api_keys: [
              { type: "publishable", title: PUBLISHABLE_KEY_TITLE, created_by: SEEDED_BY },
            ],
          },
        })
        .then(({ result }) => ({
          id: result[0]!.id,
          token: result[0]!.token,
          salesChannels: [] as (string | undefined)[],
        }));

  if (!key.salesChannels.includes(salesChannelId)) {
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

  if (!store) {
    throw new Error("Medusa creates a Store on first boot, but the seed cannot find one.");
  }

  const currencies = (store.supported_currencies ?? []).flatMap((currency) =>
    currency?.currency_code ? [currency.currency_code] : [],
  );
  const update: UpdateStoreDTO = {};

  // An Operator can price a Variant in EUR only when EUR is a supported
  // currency. The seed appends and does not assign. A currency that somebody
  // added in the admin stays.
  if (!currencies.includes(CURRENCY)) {
    update.supported_currencies = [
      ...currencies.map((currency_code) => ({ currency_code })),
      { currency_code: CURRENCY, is_default: !currencies.length },
    ];
  }

  if (!store.default_sales_channel_id) {
    update.default_sales_channel_id = defaults.salesChannelId;
  }

  // The default Region lets the Store API resolve a price when a request has
  // no region_id. The storefront sends such a request before a Shopper selects
  // anything.
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
