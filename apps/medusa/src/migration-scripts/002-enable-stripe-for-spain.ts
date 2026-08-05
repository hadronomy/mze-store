import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateRegionsWorkflow } from "@medusajs/medusa/core-flows";
import { STRIPE_PAYMENT_PROVIDER_ID, SYSTEM_PAYMENT_PROVIDER_ID } from "../payment/stripe";
import { SPAIN } from "../territory/spain";

/**
 * Makes Stripe available in the Spain Region during its registration deploy.
 *
 * The update preserves providers that an Operator enabled. It removes only the
 * system placeholder, because that provider cannot process a payment.
 */
export default async function enableStripeForSpain({ container }: { container: MedusaContainer }) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "countries.iso_2", "payment_providers.id"],
  });

  const spanish = regions.find((region) =>
    region.countries?.some((country) => country?.iso_2 === SPAIN),
  );

  if (!spanish) {
    throw new Error("The Stripe migration requires the Spain Region.");
  }

  const currentProviderIds = (spanish.payment_providers ?? []).flatMap((provider) =>
    provider?.id ? [provider.id] : [],
  );
  const paymentProviders = [
    ...currentProviderIds.filter((id) => id !== SYSTEM_PAYMENT_PROVIDER_ID),
    STRIPE_PAYMENT_PROVIDER_ID,
  ].filter((id, index, ids) => ids.indexOf(id) === index);

  if (
    currentProviderIds.includes(STRIPE_PAYMENT_PROVIDER_ID) &&
    !currentProviderIds.includes(SYSTEM_PAYMENT_PROVIDER_ID)
  ) {
    return;
  }

  await updateRegionsWorkflow(container).run({
    input: {
      selector: { id: spanish.id },
      update: { payment_providers: paymentProviders },
    },
  });
}
