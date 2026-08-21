import { MedusaError } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
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

  return `${encodeURIComponent(scope)}--${encodeURIComponent(parsed.data)}`;
}
