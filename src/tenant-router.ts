import { IdentityRouter, type BindingStore } from "./core.ts";
import type { AppRegistry } from "./github-apps.ts";

/**
 * Produce a router whose options are the GitHub App identities available
 * to the authenticated tenant. Call with a VERIFIED tenant ID only.
 */
export async function createTenantRouter(
  store: BindingStore,
  registry: AppRegistry,
  authenticatedTenantId: string,
): Promise<IdentityRouter> {
  if (!authenticatedTenantId) throw new Error("Authenticated tenant is required");
  const apps = await registry.listForTenant(authenticatedTenantId);
  return new IdentityRouter(
    store,
    apps.map(app => ({ id: app.identityId, displayName: app.displayName })),
  );
}
