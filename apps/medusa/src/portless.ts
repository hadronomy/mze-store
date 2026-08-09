type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const portlessStorefrontCors = String.raw`/^https://(?:[a-z0-9-]+\.)?storefront\.mze-store\.localhost$/`;
const portlessMedusaCors = String.raw`/^https://medusa\.mze-store\.localhost$/`;

export const portlessCors = {
  store: portlessStorefrontCors,
  admin: portlessMedusaCors,
  auth: `${portlessStorefrontCors},${portlessMedusaCors}`,
} as const;

function isPortlessDevelopment(source: EnvironmentSource) {
  return (
    Boolean(source.PORTLESS_URL) &&
    !source.CI &&
    (source.NODE_ENV === undefined || source.NODE_ENV === "development")
  );
}

/**
 * Keep Portless origins local to the optional development path.
 * The slash-delimited patterns accept the main storefront and its worktree labels.
 */
export function withPortlessCors(source: EnvironmentSource): EnvironmentSource {
  if (!isPortlessDevelopment(source)) {
    return source;
  }

  return {
    ...source,
    STORE_CORS: portlessCors.store,
    ADMIN_CORS: portlessCors.admin,
    AUTH_CORS: portlessCors.auth,
  };
}
