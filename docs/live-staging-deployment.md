# One-time private staging deployment

> **Operator action required; manual workflow only.** This is a deployment guide for the *actual* TypeScript MCP server, not for the temporary 503-only staging bootstrap. Source code and the unit/D1/MCP tests are already merged. Keep GitHub reads and writes **disabled** for the initial login test.

## Current environment

The operator previously provisioned a private Cloudflare Access Managed OAuth application for the staging Worker hostname and a separate D1 database. The staging domain is intended for **the operator and invited users only**, not a free public plugin service.

The Access application is restricted by an email policy and Google sign-in; its Managed OAuth settings include ChatGPT's current redirect patterns. The API bootstrap was replaced by the **actual source-built MCP Worker** on November 18, 2026 via [successful manual deploy 44378420871](https://github.com/keego/github-agent-identities/actions/runs/44378420871) (46/46 tests, Cloudflare Worker build, version `28957b9e-c62a-4c1c-a625-9f8a5d61b9dd`). The full authentication and tool-execution flow **has not** been exercised from a real ChatGPT client.

### Manual GitHub Actions workflow

This project has a **manual-only** workflow, [`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml). It **never triggers on a push or PR**. It runs `npm run qa:local` and then `npx cf deploy --mode staging --no-provision` when the operator requests it. For the **first** deployment only, it offers an explicitly confirmed `takeover_api_bootstrap` option that adds `--force` to replace the 503-only Worker originally created through the Cloudflare Script API. Normal deployments do **not** use `--force`. This preserves the local-first QA / reduced Actions burn-rate strategy.

1. In the GitHub repository, open **Settings → Environments**, and create an environment called `staging`. Optionally enable required reviewer approval.
2. Under **staging → Environment variables**, configure:

   | Name | Value |
   | --- | --- |
   | `CLOUDFLARE_ACCOUNT_ID` | The operator's Cloudflare account ID |
   | `STAGING_D1_DATABASE_ID` | The UUID of the pre-existing **staging** D1 database |
   | `ACCESS_ISSUER` | The configured team issuer, e.g. `https://team.cloudflareaccess.com` |
   | `ACCESS_AUDIENCE` | **This** staging Access application's `aud`, not a token or another Access app's audience |
   | `MCP_PUBLIC_HOSTNAME` | The hostname of the actual staging Worker, with no scheme or path |

3. Under **staging → Environment secrets**, configure:

   | Name | Contents |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | A new, least-privilege Cloudflare API token for managing this Worker's scripts/bindings. Do not use a global API key. |
   | `ALLOWED_ACCESS_EMAILS` | Comma-separated verified email addresses explicitly invited to this private instance; keep the value out of Git, comments and logs |

   Make sure the Cloudflare API token can **edit Workers scripts and read the already-created D1 binding** in the specified account. Use Cloudflare's API-token permissions guidance; the CLI may report extra required scopes for your setup. Do not put your private GitHub App key in GitHub Actions.

4. From **Actions → Deploy private MCP staging (manual) → Run workflow**, choose **`main`**. **The first API-bootstrap takeover has already succeeded**; leave `takeover_api_bootstrap` **unchecked** on every ordinary future run. Only if you are deliberately replacing a new API-managed bootstrap in another environment should you select **`takeover_api_bootstrap` = true** (check the box). This adds `--force` only for that explicitly approved first takeover. Leave the box **unchecked on all future deployments**, which use the normal, conflict-protected deployment path. The job rejects missing variables, runs all tests and a Worker build, and always retains `--no-provision` so it cannot silently create a second database. Its `enable_github_app_reads` input **defaults to unchecked**; ordinary runs keep GitHub reads disabled. Only check it after the #17 private PEM and tenant-scoped D1 identity are provisioned and reviewed. The workflow checks for the exact App secret binding before allowing read-only tools; GitHub writes remain unregistered. See [read-only App pilot](github-pilot-readonly.md). A separate default-off `approve_verified_config_override` input permits a one-run `--force --no-provision` **only after checking the live Worker's exact seven bindings, secret type, D1 UUID and compatibility settings**. Use it only when `cf` refuses the expected toggle/D1 metadata drift; never combine it with `takeover_api_bootstrap` or use it to bypass unexpected configuration changes.
5. Once the workflow succeeds, open the staging `https://<worker-host>/health` behind Access. Complete the invited-user sign-in. An authenticated health check should return `healthy`; unauthenticated requests should encounter an Access authentication challenge.
6. Connect a **custom MCP server** in ChatGPT using `https://<worker-host>/mcp` and authenticate through Cloudflare Access Managed OAuth. On November 19, an authenticated staging client successfully invoked `list_identities`, `identify_chat` and `get_my_tenant_id`; the identity registry was empty. Other installations must verify these calls independently.
7. The workflow also performs a **credential-free HTTP probe** of the deployed `/health` route. Access must deny an anonymous request (HTTP 302/401/403 rather than 2xx); an unexpectedly public health route **fails the deploy job**. This is an edge-policy check, not a logged-in OAuth test.
8. Verify Cloudflare Worker **version/preview URLs remain disabled** (`previewUrls: false` in `cloudflare.config.ts`), or there could be an alternative hostname outside the Access policy.
9. Check an uninvited account, expired/revoked token, cross-user isolation, reconnection and authenticated chat binding persistence. **Do not close [#16](https://github.com/keego/github-agent-identities/issues/16) merely because the November 19 single-user smoke test passed.**

### No production token / GitHub App key required yet

Only the Cloudflare *deployment* API token is needed for this workflow. The GitHub App PEM belongs later in the private **Cloudflare Worker secrets** interface, as described in [read-only pilot setup](github-pilot-readonly.md) and [Issue #17](https://github.com/keego/github-agent-identities/issues/17). Do not share it in chat, a PR, environment variable, or repository file.

### Rollback / safety

- `cf deploy --no-provision` refuses to create missing resources rather than silently provisioning replacements.
- **Preview routes:** `cloudflare.config.ts` explicitly sets `previewUrls: false`; the deployment smoke check must also ensure anonymous health access is denied at the main hostname. Do not turn off the Access policy for debugging.
- **One-time takeover risk:** `--force` deliberately overrides the old API-managed bootstrap Worker code/config with the reviewed Git-backed staging build. Before selecting the takeover checkbox, confirm the remote Worker is `github-agent-identities-staging`, it still has only the expected staging D1 binding, and the Cloudflare Access owner-only application remains active. Do not select takeover mode for normal deployments or other Workers. The first takeover does not bypass Cloudflare Access, tests or `--no-provision`.
- This workflow uses the existing `github-agent-identities-staging` Worker name; it does **not** deploy to production, alter the existing Roommate Ledger/Homelab Access apps, or make the endpoint publicly usable.
- The Cloudflare Access policy is configured independently from the Worker bundle. On a bad build, use Cloudflare Worker version rollback in the dashboard. **Do not remove Access protection** to troubleshoot.
- If GitHub Actions preflight fails, fix the workflow or API-token permissions rather than turning off the tests. Confirm the actual deploy job outcome before claiming the service is live.

See [Cloudflare staging guide](cloudflare-staging.md), [private Access setup](cloudflare-access.md), and [GitHub Agent Identities roadmap](roadmap.md).
