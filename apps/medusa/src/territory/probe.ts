import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createProductsWorkflow,
  createShippingProfilesWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows";
import { CURRENCY } from "./spain";

/** The identifiers that a caller needs to read a price back. */
export type SeededProbe = {
  productId: string;
  publishableKey: string;
  shippingProfileId: string;
};

/**
 * The price of the probe Variant, in EUR and without tax.
 *
 * A round hundred gives an exact result in both regimes: 121,00 € and
 * 107,00 €. A wrong rate is therefore easy to see, and no rounding argument
 * can hide it.
 */
export const PROBE_PRICE = 100;

export const PROBE_OPTION = { title: "Size", value: "One size" };

const PROBE_PRODUCT_HANDLE = "tax-model-probe";
const SHIPPING_PROFILE_NAME = "Default";
const PUBLISHABLE_KEY_TITLE = "Storefront";
const SEEDED_BY = "seed";

/**
 * Creates the Product, the Variant, and the key that read a price back from
 * the Store API.
 *
 * CAUTION: Do not run this against a live store. The Product is published and
 * it is in the Sales Channel, so a Shopper sees it and can buy it. It exists to
 * prove the territory model, and a real catalogue replaces it.
 *
 * This is why it is not part of `seedSpanishTerritory`. That seed carries the
 * tax model, which is policy and safe anywhere. This one carries a fixture.
 */
export async function seedTerritoryProbe(
  container: MedusaContainer,
  territory: { salesChannelId: string },
): Promise<SeededProbe> {
  const shippingProfileId = await ensureShippingProfile(container);
  const productId = await ensureProbeProduct(container, {
    salesChannelId: territory.salesChannelId,
    shippingProfileId,
  });
  const publishableKey = await ensurePublishableKey(container, territory.salesChannelId);

  return { productId, publishableKey, shippingProfileId };
}

const queryOf = (container: MedusaContainer) => container.resolve(ContainerRegistrationKeys.QUERY);

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

  // Every Product needs one, and the probe is the only Product here. An
  // Operator creates the profiles a real catalogue needs, in the admin.
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
          // Published on purpose: an unpublished Product returns no price from
          // the Store API, and the price is the whole point of this Product.
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
