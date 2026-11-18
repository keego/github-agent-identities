-- Populate only after authenticated tenant onboarding exists.
-- tenant_id must represent a server-verified principal, not caller-supplied text.
CREATE TABLE IF NOT EXISTS github_app_identities (
  tenant_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  app_id INTEGER NOT NULL,
  installation_id INTEGER NOT NULL,
  secret_ref TEXT NOT NULL,
  allowed_repos_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, identity_id)
);
