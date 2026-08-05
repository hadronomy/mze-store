import { Modules } from "@medusajs/framework/utils";
import type { IAuthModuleService, MedusaContainer } from "@medusajs/framework/types";
import { createUsersWorkflow } from "@medusajs/medusa/core-flows";

type Api = {
  post: (path: string, body?: unknown, config?: unknown) => Promise<{ data: { token: string } }>;
};

/**
 * Creates an Operator, signs them in, and returns headers that authenticate
 * admin requests as that Operator.
 *
 * This function does what `medusa user` does. It creates a User and an
 * emailpass auth identity, and it binds them with `app_metadata.user_id`. No
 * admin route creates the first Operator. A test that needs one must therefore
 * do both parts itself.
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
