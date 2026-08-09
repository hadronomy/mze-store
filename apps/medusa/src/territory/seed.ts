import type { MedusaContainer, UpdateStoreDTO } from "@medusajs/framework/types";
import {
  createLocationFulfillmentSetWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createServiceZonesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { STRIPE_PAYMENT_PROVIDER_ID } from "../payment/stripe";
import type { TerritoryDeclaration } from "./declaration";
import {
  findDeclaredStockLocation,
  findRegionForDeclaration,
  findSalesChannelByName,
  findStockLocationById,
  findStore,
  findTaxRegionsForDeclaration,
} from "./queries";

/** The identifiers that a caller needs to use what the seed created. */
export type SeededTerritory = {
  regionId: string;
  salesChannelId: string;
  currency: string;
};

/**
 * The tax provider that Medusa includes. It reads the rates in this project
 * and does not call an external tax service. A Tax Region carries a parent or
 * a provider, never both. Only the country-level Tax Region gets this one.
 */
const SYSTEM_TAX_PROVIDER = "tp_system";

const SALES_CHANNEL_NAME = "Default Sales Channel";
const FULFILLMENT_SET_NAME = "Shipping";
const SEEDED_BY = "seed";

/**
 * Applies a Territory Declaration to the database. It creates nothing that a
 * Shopper sees, so it is safe against a live store. `./probe.ts` is not.
 *
 * The seed is idempotent by identity and not by a marker. It finds each piece
 * by something stable: the Region by the country it carries, a Tax Region by
 * its Province, a Service Zone by its name. It creates a piece only when that
 * piece is absent. A second run therefore creates nothing, and a run against a
 * database that has some of the model creates the rest.
 *
 * The seed creates, but it does not correct. It keeps a Region or a rate that
 * an Operator changed in the admin. This is deliberate: the database is
 * authoritative, and the Declaration only starts a new one. A seed that
 * converges reverts a lawful rate change at the next deploy.
 *
 * This holds for a Service Zone too. The seed creates a zone that is absent,
 * and it never edits one that is there. `ensureServiceZones` says why.
 */
export async function seedTerritory(
  container: MedusaContainer,
  declaration: TerritoryDeclaration,
): Promise<SeededTerritory> {
  const salesChannelId = await ensureSalesChannel(container);
  const regionId = await ensureRegion(container, declaration);
  await ensureTaxRegions(container, declaration);

  const stockLocationId = await ensureStockLocation(container, salesChannelId, declaration);
  await ensureServiceZones(container, stockLocationId, declaration);

  await ensureStoreDefaults(container, { salesChannelId, regionId }, declaration);

  return { regionId, salesChannelId, currency: declaration.currency };
}

async function ensureSalesChannel(container: MedusaContainer): Promise<string> {
  // Medusa creates a Store and a default Sales Channel on first boot. The seed
  // uses that channel, because the Store ignores any second channel.
  const store = await findStore(container);
  const existing = store?.default_sales_channel_id;
  if (existing) {
    return existing;
  }

  const channel = await findSalesChannelByName(container, SALES_CHANNEL_NAME);

  if (channel) {
    return channel.id;
  }

  const { result } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: SALES_CHANNEL_NAME }] },
  });

  return result[0]!.id;
}

async function ensureRegion(
  container: MedusaContainer,
  declaration: TerritoryDeclaration,
): Promise<string> {
  // The lookup uses the country and not the name. A country belongs to exactly
  // one Region.
  const existing = await findRegionForDeclaration(container, declaration);

  if (existing) {
    return existing.id;
  }

  const { result } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: declaration.regionName,
          currency_code: declaration.currency,
          countries: [declaration.country],
          payment_providers: [STRIPE_PAYMENT_PROVIDER_ID],
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

async function ensureTaxRegions(
  container: MedusaContainer,
  declaration: TerritoryDeclaration,
): Promise<void> {
  const taxRegions = await findTaxRegionsForDeclaration(container, declaration);

  // The country-level Tax Region is not one entry among many. If no parent
  // region exists, Medusa returns no tax line for an address in the declared
  // country. This region also carries the default regime, which every Province
  // without its own regime uses.
  let parentId = taxRegions.find((region) => region.province_code === null)?.id;

  if (!parentId) {
    const { result } = await createTaxRegionsWorkflow(container).run({
      input: [
        {
          country_code: declaration.country,
          provider_id: SYSTEM_TAX_PROVIDER,
          default_tax_rate: { ...declaration.defaultRegime },
          created_by: SEEDED_BY,
        },
      ],
    });

    parentId = result[0]!.id;
  }

  const missing = declaration.provinceRegimes.flatMap((regime) =>
    Object.keys(regime.provinces)
      .filter((province) => !taxRegions.some((region) => region.province_code === province))
      .map((province) => ({
        country_code: declaration.country,
        province_code: province,
        parent_id: parentId,
        default_tax_rate: {
          name: regime.name,
          code: regime.code,
          rate: regime.rate,
        },
        created_by: SEEDED_BY,
      })),
  );

  if (!missing.length) {
    return;
  }

  await createTaxRegionsWorkflow(container).run({ input: missing });
}

/**
 * Fails loudly when a stock location read returns nothing.
 *
 * The seed creates the location before it reads it back, so an absent location
 * means the create failed without an error. That is worth a stack trace here
 * and not a `TypeError` three lines later.
 */
const requireStockLocation = (
  location: Awaited<ReturnType<typeof findDeclaredStockLocation>>,
  declaration: TerritoryDeclaration,
) => {
  if (!location) {
    throw new Error(
      `The seed created the stock location ${declaration.stockLocationName}, but it cannot find it again.`,
    );
  }

  return location;
};

const provinceGeoZone = (country: string, province: string) => ({
  type: "province" as const,
  country_code: country,
  province_code: province,
});

async function ensureStockLocation(
  container: MedusaContainer,
  salesChannelId: string,
  declaration: TerritoryDeclaration,
): Promise<string> {
  let location = await findDeclaredStockLocation(container, declaration);

  if (!location) {
    // The location has no address. An Operator enters the address of the shop.
    // Shipping resolves from the Service Zones and not from this location.
    await createStockLocationsWorkflow(container).run({
      input: { locations: [{ name: declaration.stockLocationName }] },
    });

    location = requireStockLocation(
      await findDeclaredStockLocation(container, declaration),
      declaration,
    );
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
  declaration: TerritoryDeclaration,
): Promise<void> {
  let location = requireStockLocation(
    await findStockLocationById(container, stockLocationId),
    declaration,
  );

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

    location = requireStockLocation(
      await findStockLocationById(container, stockLocationId),
      declaration,
    );
    fulfillmentSet = location.fulfillment_sets?.find(setNamed);
  }

  if (!fulfillmentSet) {
    throw new Error(
      `The seed created the fulfillment set ${FULFILLMENT_SET_NAME}, but it cannot find it again.`,
    );
  }

  const fulfillmentSetId = fulfillmentSet.id;
  const existingZones = (fulfillmentSet.service_zones ?? []).filter((zone) => !!zone);

  const newZones = declaration.serviceZones.filter(
    (zone) => !existingZones.some((existing) => existing.name === zone.name),
  );

  if (!newZones.length) {
    return;
  }

  // A zone the seed creates gets its Provinces. A zone that exists gets
  // nothing, not even a Province this list has and the zone does not.
  //
  // The seed cannot tell a gap from a removal: an Operator who stops shipping
  // to a Province leaves a hole that looks exactly like one the seed never
  // filled. It runs on every deploy, so a seed that filled holes would undo
  // that Operator on the next one, every time, with no way to make the change
  // stick. Provinces a zone needs and does not have are added in the admin.
  await createServiceZonesWorkflow(container).run({
    input: {
      data: newZones.map((zone) => ({
        name: zone.name,
        fulfillment_set_id: fulfillmentSetId,
        geo_zones: zone.provinces.map((province) => provinceGeoZone(declaration.country, province)),
      })),
    },
  });
}

async function ensureStoreDefaults(
  container: MedusaContainer,
  defaults: { salesChannelId: string; regionId: string },
  declaration: TerritoryDeclaration,
): Promise<void> {
  const store = await findStore(container);

  // Medusa creates the Store when the application boots, and `db:migrate` runs
  // before any boot. So on a database that has never served a request there is
  // no Store to update, and the seed makes it.
  //
  // Medusa's own default step takes the first Store it finds and creates one
  // only when there is none, so the boot that follows adopts this one rather
  // than adding a second.
  if (!store) {
    await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            supported_currencies: [{ currency_code: declaration.currency, is_default: true }],
            default_sales_channel_id: defaults.salesChannelId,
            default_region_id: defaults.regionId,
          },
        ],
      },
    });

    return;
  }

  const currencies = (store.supported_currencies ?? []).flatMap((currency) =>
    currency?.currency_code ? [currency.currency_code] : [],
  );
  const update: UpdateStoreDTO = {};

  // An Operator can price a Variant in the declared currency only when the
  // Store supports it. The seed appends and does not assign. A currency that
  // somebody added in the admin stays.
  if (!currencies.includes(declaration.currency)) {
    update.supported_currencies = [
      ...currencies.map((currency_code) => ({ currency_code })),
      { currency_code: declaration.currency, is_default: !currencies.length },
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
