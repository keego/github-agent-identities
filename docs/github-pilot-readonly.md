# Read-only GitHub App pilot — Issue #17

> **Status: integration code and mocked tests only.** A live GitHub App read requires a deployed Cloudflare Access-protected Worker, an invited account, a selected App installation, and a securely provisioned PEM key. **No GitHub App secret or real token is in the repository.**

## What this stage adds

The private Worker can register **`github_get_pull_request`** after validating a human Cloudflare Access identity, loading that user's App registry from D1, and confirming an explicit operator flag `GH_APP_READONLY_ENABLED=true`. No GitHub write/comment tools are registered. The server continues to reject missing or forged Access assertions and requires a conversation-specific binding before fetching any GitHub data.

The sequence is:

1. Access verifies the human user and Worker checks the signed JWT + invited-user allowlist.
2. `get_my_tenant_id` returns that user's opaque tenant identifier. Use it **only** to onboard this verified user into the operator-controlled App registry.
3. Operator inserts the user's approved App identity into D1.
4. The user calls `list_identities` and `bind_identity` from a ChatGPT conversation.
5. When `GH_APP_READONLY_ENABLED=true`, `github_get_pull_request` looks up that conversation's identity, validates the repository allowlist, obtains a short-lived installation token, and reads the PR from the GitHub REST API.

A role ID may be machine-friendly (e.g. `poster-brain--ui-ux-designer`), while its displayed name remains **UI/UX Designer**.

## Required verified identities

| Value | Pilot | Secret? |
| --- | --- | --- |
| App display name | Poster Brain - UI/UX Designer | No |
| GitHub App ID | `5808833` | No |
| GitHub installation ID | `183125278` | No |
| Allowed repository | `keego/poster-brain` (must verify actual installation access) | No |
| Server-side secret reference | `GH_APP_DESIGN_PRIVATE_KEY` | No (name only) |
| Secret value | PEM generated under the App's GitHub General settings | **Yes** |
| Authenticated tenant ID | `get_my_tenant_id` result, derived from signed Access JWT | Pseudonymous; don't publish as personal data |

The App ID identifies the GitHub App; the installation ID selects its instance installed on an account/organization. Both are public configuration identifiers. The private key signs the App JWT; that JWT is exchanged for a short-lived bearer installation token. The server never returns or logs the key, JWT or installation token.

## Operator-only setup steps (after #16 live OAuth validation)

1. Confirm `github-agent-identities-staging` has both D1 schema migrations and a Worker binding. Ensure the Worker is protected by Cloudflare Access **Managed OAuth** for the entire Worker, not just one hostname.
2. Sign in from an invited ChatGPT session and call `get_my_tenant_id`. Copy the returned `cloudflare-access:...` value into your **private** D1 setup workflow; do not place it in a public GitHub issue.
3. In GitHub App settings for ID `5808833`, verify installation `183125278` belongs to this App and has access to `keego/poster-brain` with **Pull requests: Read** or greater. Selecting an App name or installation ID alone does not guarantee access.
4. Generate a new private key under the GitHub App's General settings if necessary. In the **Cloudflare Workers dashboard**, navigate to your private **staging Worker → Settings → Variables and Secrets → Add Secret**, name it `GH_APP_DESIGN_PRIVATE_KEY`, and paste the PEM **there**. Never paste the PEM into a ChatGPT conversation, GitHub PR/issue, D1 field, log, or repository file.
5. Add the registry row to the staging database using an operator-controlled D1 console or authenticated CLI. Use the verified tenant ID from step 2 and SQL like this, replacing the placeholder:

```sql
INSERT INTO github_app_identities (
  tenant_id, identity_id, display_name, app_id, installation_id,
  secret_ref, allowed_repos_json
) VALUES (
  'cloudflare-access:REPLACE_WITH_VERIFIED_USER_SUB',
  'poster-brain--ui-ux-designer',
  'UI/UX Designer',
  5808833,
  183125278,
  'GH_APP_DESIGN_PRIVATE_KEY',
  '["keego/poster-brain"]'
);
```

This stores public configuration and a **secret name**, never the PEM value. Only operators may modify this table; the MCP client has no D1 insert/update tool for App ownership.

6. Once the App PEM secret and D1 registry record are installed, merge the reviewed read-only pilot workflow and run **Actions → Deploy private MCP staging (manual)** on `main` with `takeover_api_bootstrap` **unchecked** and `enable_github_app_reads` **checked**. If the normal `cf deploy` refuses expected dashboard configuration drift (the read-only flag and D1 name metadata), use the separately reviewed `approve_verified_config_override` checkbox **only for a rerun after inspecting the diff**. That checkbox remains off by default and requires an exact remote binding/secret/D1/runtime preflight before `--force --no-provision`; any extra or altered binding fails closed. The new input defaults to false; when checked, preflight verifies the expected secret **binding name** on this exact staging Worker without requesting or printing its value. GitHub Actions must never receive the PEM. The workflow runs full QA, deploys with `GH_APP_READONLY_ENABLED=true`, and checks anonymous Access denial. **No comment/write tools are enabled.** On later ordinary deploys, explicitly re-check the read-only input only if continuing the approved pilot; unchecked disables reads again.
7. After the pilot deploy, confirm Cloudflare still lists the `GH_APP_DESIGN_PRIVATE_KEY` secret binding (Cloudflare Worker secrets are expected to persist across deployments; verify rather than assume). In ChatGPT, call `list_identities`, select `poster-brain--ui-ux-designer` with `bind_identity`, then call `github_get_pull_request` on a known PR in `keego/poster-brain`. Verify the response and server permissions; do not assume the read test passed until observed.
8. Repeat with an unauthorized repository, an unbound chat, an uninvited user and revoked/expired App credentials. All should fail with no fallback to a personal GitHub OAuth connector.

To rotate the key, replace the Worker secret through the protected Cloudflare secrets interface and invalidate any cached tokens. Uninstalling/reinstalling the App may change its installation ID; re-verify the selected repositories and update the D1 record.

## Expected non-ready behavior

- Missing Access issuer/audience/email allowlist → HTTP 503; no MCP tools.
- Missing/invalid signed Access JWT → HTTP 401; no MCP tools.
- Uninvited verified human → HTTP 403; no MCP tools.
- `GH_APP_READONLY_ENABLED` absent/false → identity tools only.
- No user registry row → empty identity choices.
- No conversation binding / wrong repository → GitHub read tool returns an error without obtaining a token.
- Missing PEM / revoked App installation → read tool returns a sanitized error, never a key/token.
- Comment-write tool is **absent in this phase**, regardless of any configuration.

## Verification and follow-up

PR #22 tests this wiring with synthetic signed Access identities and mocked GitHub token behavior. It must also pass the real local D1 tests and Cloudflare Worker build. Live acceptance for [#17](https://github.com/keego/github-agent-identities/issues/17) requires an actual Cloudflare Access login, actual Worker secret provisioning and a successful GitHub App PR read. First bot-attributed comment is a separate [#5](https://github.com/keego/github-agent-identities/issues/5) milestone and will require explicit review of the write path.

See [Access setup](cloudflare-access.md), [Cloudflare staging](cloudflare-staging.md), and [GitHub App setup](github-app-setup.md).
