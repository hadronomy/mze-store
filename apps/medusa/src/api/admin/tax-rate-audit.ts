import type { HttpTypes, MedusaContainer } from "@medusajs/framework/types";
import { z } from "@medusajs/framework/zod";
import {
  ContainerRegistrationKeys,
  MedusaError,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";
import { randomUUID } from "node:crypto";

const IdempotencyKeySchema = z.string().trim().min(1).max(200);

export function operationIdFromRequest(
  request: { get(name: string): string | undefined },
  scope: string,
): string {
  const header = request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key");
  if (header === undefined) {
    return `${encodeURIComponent(scope)}--${randomUUID()}`;
  }

  const parsed = IdempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Idempotency-Key must contain 1 to 200 characters.",
    );
  }

  const requestKey = parsed.data;
  return `${encodeURIComponent(scope)}--${encodeURIComponent(requestKey)}`;
}

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
