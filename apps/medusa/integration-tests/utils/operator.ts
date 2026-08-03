import { Modules } from "@medusajs/framework/utils";
import type { IAuthModuleService, MedusaContainer } from "@medusajs/framework/types";
import { createUsersWorkflow } from "@medusajs/medusa/core-flows";

type Api = {
  post: (path: string, body?: unknown, config?: unknown) => Promise<{ data: { token: string } }>;
};

/**
 * Create an Operator and sign it in, returning headers that authenticate admin
 * requests as it.
 *
 * Mirrors what `medusa user` does — a User and an emailpass auth identity
 * bound to it by `app_metadata.user_id`. There is no admin route that creates
 * the first Operator, so a test that needs one has to do both halves itself.
 */
export async function signInAsOperator(
  container: MedusaContainer,
  api: Api,
  credentials: { email: string; password: string },
): Promise<{ headers: Record<string, string> }> {
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);

  const { result: users } = await createUsersWorkflow(container).run({
    input: { users: [{ email: credentials.email }] },
  });

  const { authIdentity, success, error } = await auth.register("emailpass", {
    body: credentials,
  });

  if (!success || !authIdentity) {
    throw new Error(`Could not register the Operator's auth identity: ${error}`);
  }

  await auth.updateAuthIdentities({
    id: authIdentity.id,
    app_metadata: { user_id: users[0]!.id },
  });

  const response = await api.post("/auth/user/emailpass", credentials);

  return { headers: { authorization: `Bearer ${response.data.token}` } };
}
