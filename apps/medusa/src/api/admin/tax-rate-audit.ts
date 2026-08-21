import type { HttpTypes, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, remoteQueryObjectFromString } from "@medusajs/framework/utils";

export async function refetchTaxRate(
  id: string,
  scope: MedusaContainer,
  fields: string[],
): Promise<HttpTypes.AdminTaxRate> {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const [taxRate] = await remoteQuery(
    remoteQueryObjectFromString({
      entryPoint: "tax_rate",
      variables: { filters: { id } },
      fields,
    }),
  );

  return taxRate;
}

export async function refetchTaxRegion(
  id: string,
  scope: MedusaContainer,
  fields: string[],
): Promise<HttpTypes.AdminTaxRegion> {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const [taxRegion] = await remoteQuery(
    remoteQueryObjectFromString({
      entryPoint: "tax_region",
      variables: { filters: { id } },
      fields,
    }),
  );

  return taxRegion;
}
