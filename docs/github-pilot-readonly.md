# Read-only GitHub App pilot — Issue #17

> **Status (Nov 20, 2026): complete.** The authenticated, bound Designer ChatGPT conversation successfully read PR #22 through the actual GitHub App (`ok:true`); #17 is closed. No App secret or token has been placed in the repository. Subsequent guarded bot-comment experiments are separately tracked under [#5](https://github.com/keego/github-agent-identities/issues/5).

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

## Read-only pilot diagnostics (sanitized)

GitHub-generated App keys are PKCS#1, while the WebCrypto signer accepts PKCS#8. The Worker converts a valid RSA private key **in memory** before calling Octokit and never writes the converted PEM to D1, GitHub Actions or logs. A malformed or non-RSA key fails with a fixed error code; the operator must correct the Cloudflare secret privately. <https://github.com/gr2m/universal-github-app-jwt#about-private-key-formats>

If the authenticated, bound `github_get_pull_request` tool returns an error, record **only** the fixed error code, the structured read-only diagnostics and PR number, never a PEM, JWT, installation token, Access assertion, or upstream error body.

**One-shot failure checks:** After the authorized PR request fails, the same installation token performs at most two further GETs: `/repos/{owner}/{repo}` (repository visibility) and `/installation/repositories?per_page=100` (installation repository selection). The tool returns only HTTP status numbers and `repositorySelected: true | false | null`. A result of `false` means a **complete** repo listing did not include the target; if the listing is paginated or unreadable, `null` means unknown rather than assuming exclusion. GitHub may return 404 for resources hidden by permissions. These probes are not invoked for unbound chats, disallowed repositories, failed token issuance or successful PR reads. They never publish GitHub response bodies, tokens or other repository names.

| Code | Safe interpretation | Operator follow-up |
| --- | --- | --- |
| `IDENTITY_NOT_BOUND` | This chat has no selected App | Bind the current conversation first |
| `REPOSITORY_NOT_ALLOWED` | Repository not on this identity's allowlist | Verify intended authorization in the operator-owned registry |
| `APP_NOT_CONFIGURED` / `APP_REGISTRY_FAILED` | App entry missing or scoped D1 retrieval failed | Inspect the authenticated tenant's registry row and D1 health |
| `APP_SECRET_REF_INVALID` / `APP_SECRET_UNAVAILABLE` | Secret reference invalid or Worker key binding unavailable | Verify secret **name/type** in Cloudflare; never read the value into chat |
| `APP_KEY_FORMAT_INVALID` | The Worker could not parse the secret as an RSA private key or normalize it to PKCS#8 | Check that Cloudflare stores the complete GitHub-generated PEM, including both delimiters; never paste its contents into chat or logs |
| `APP_JWT_SIGNING_FAILED` | The key was parsed and normalized, but local App JWT signing still failed | Investigate Worker crypto compatibility, not installation permissions |
| `APP_INSTALLATION_TOKEN_FAILED` | Local signing passed, but GitHub installation-token exchange did not complete | Verify App ID, installation ID, installation status, and GitHub access; do not assume repo permissions without checking |
| `APP_TOKEN_INVALID` | Token exchange returned an unusable or expiring token | Recheck installation exchange and token lifetime |
| `GITHUB_RESOURCE_NOT_FOUND_OR_INACCESSIBLE` | GitHub returned HTTP 404; PR may be absent **or hidden** from this installation | Check that the App installation includes the repository; verify that the PR exists separately; confirm Pull requests: Read permission |
| `GITHUB_REQUEST_FORBIDDEN` | GitHub returned HTTP 403 without primary rate-limit exhaustion | Check effective App installation permission, installation approval, and account restrictions |
| `GITHUB_REQUEST_UNAUTHORIZED` | GitHub returned HTTP 401 after token issuance | Recheck GitHub App installation authorization; do not share tokens |
| `GITHUB_RATE_LIMITED` | GitHub returned HTTP 429 or HTTP 403 with remaining primary quota zero | Observe GitHub retry/rate limits; do not rotate credentials |
| `GITHUB_BAD_REQUEST` | GitHub returned HTTP 400 or 422 | Inspect endpoint and supported API request parameters, without exposing request headers |
| `GITHUB_SERVICE_UNAVAILABLE` | GitHub returned HTTP 5xx | Check GitHub API health and retry after service recovery |
| `GITHUB_REQUEST_FAILED` | Unexpected HTTP status, fetch transport error, or invalid JSON response | Inspect runtime networking separately; no raw upstream details returned |
| `INTERNAL_ERROR` | Unexpected failure outside classified App-token stages | Investigate the server-side path without dumping sensitive exception contents |

A connector may wrap a tool's `isError` response in a generic runtime error such as `INVALID_ARGUMENT`; inspect the JSON **inside** the MCP tool response for the actual fixed code. Successful tool discovery and binding alone never prove GitHub App authentication.

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
