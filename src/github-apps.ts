/**
 * GitHub App configurations are scoped to an authenticated tenant.
 * NEVER treat MCP session metadata as a proof of tenancy.
 */
import type { SqlDatabase } from "./d1-store.ts";

export type AppIdentity = Readonly<{
  identityId: string;
  displayName: string;
  appId: number;
  installationId: number;
  secretRef: string;
  allowedRepositories: readonly string[];
}>;

export interface AppRegistry {
  getForTenant(tenantId: string, identityId: string): Promise<AppIdentity | null>;
  listForTenant(tenantId: string): Promise<AppIdentity[]>;
}

type RecordRow = {
  identity_id: string;
  display_name: string;
  app_id: number;
  installation_id: number;
  secret_ref: string;
  allowed_repos_json: string;
};

function validateRow(row: RecordRow): AppIdentity {
  const repos: unknown = JSON.parse(row.allowed_repos_json);
  if (!Number.isSafeInteger(row.app_id) || row.app_id <= 0 ||
      !Number.isSafeInteger(row.installation_id) || row.installation_id <= 0 ||
      !Array.isArray(repos) || !repos.every(r => typeof r === "string" && /^[\w.-]+\/[\w.-]+$/.test(r)) ||
      !/^GH_APP_[A-Z0-9_]+_PRIVATE_KEY$/.test(row.secret_ref)) {
    throw new Error("Invalid GitHub App registry configuration");
  }
  return {
    identityId: row.identity_id,
    displayName: row.display_name,
    appId: row.app_id,
    installationId: row.installation_id,
    secretRef: row.secret_ref,
    allowedRepositories: repos.map(r => r.toLowerCase()),
  };
}

interface RegistryDb {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
}

export class D1AppRegistry implements AppRegistry {
  constructor(private readonly db: RegistryDb) {}

  async getForTenant(tenantId: string, identityId: string): Promise<AppIdentity | null> {
    const row = await this.db.prepare(
      "SELECT identity_id, display_name, app_id, installation_id, secret_ref, allowed_repos_json " +
      "FROM github_app_identities WHERE tenant_id = ?1 AND identity_id = ?2"
    ).bind(tenantId, identityId).first<RecordRow>();
    return row ? validateRow(row) : null;
  }

  async listForTenant(tenantId: string): Promise<AppIdentity[]> {
    const rows = await this.db.prepare(
      "SELECT identity_id, display_name, app_id, installation_id, secret_ref, allowed_repos_json " +
      "FROM github_app_identities WHERE tenant_id = ?1 ORDER BY display_name"
    ).bind(tenantId).all<RecordRow>();
    return rows.results.map(validateRow);
  }
}

export function assertRepositoryAllowed(identity: AppIdentity, repository: string): void {
  if (!identity.allowedRepositories.includes(repository.toLowerCase())) {
    throw new Error("Repository is not authorized for the selected GitHub App");
  }
}

/** A test adapter; production tenants must be derived from verified authentication. */
export class MemoryAppRegistry implements AppRegistry {
  private readonly entries = new Map<string, AppIdentity[]>();

  setForTenant(tenantId: string, identities: AppIdentity[]) {
    this.entries.set(tenantId, identities);
  }

  async getForTenant(tenantId: string, identityId: string) {
    return (this.entries.get(tenantId) ?? []).find(item => item.identityId === identityId) ?? null;
  }

  async listForTenant(tenantId: string) {
    return [...(this.entries.get(tenantId) ?? [])];
  }
}
