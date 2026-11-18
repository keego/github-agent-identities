-- Only derived, pseudonymous binding keys are persisted.
-- Never store raw ChatGPT session IDs or raw OpenAI subjects.
CREATE TABLE IF NOT EXISTS conversation_bindings (
  binding_key TEXT PRIMARY KEY NOT NULL,
  identity_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_conversation_bindings_identity
  ON conversation_bindings(identity_id);
