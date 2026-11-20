-- One-attempt staging write gate. No comment content, passwords, PEMs or tokens.
CREATE TABLE IF NOT EXISTS pilot_comment_attempts (
  tenant_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  identity_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'attempted' CHECK(state IN ('attempted','posted')),
  github_comment_id INTEGER,
  github_comment_url TEXT,
  github_author TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, repository, pr_number)
);
