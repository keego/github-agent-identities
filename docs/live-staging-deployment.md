# One-time private staging deployment

> **Operator action required; manual workflow only.** This is a deployment guide for the *actual* TypeScript MCP server, not for the temporary 503-only staging bootstrap. Source code and the unit/D1/MCP tests are already merged. Keep GitHub reads and writes **disabled** for the initial login test.

## Current environment

The operator previously provisioned a private Cloudflare Access Managed OAuth application for the staging Worker hostname and a separate D1 database. The staging domain is intended for **the operator and invited users only**, not a free public plugin service.

The Access application is restricted by an email policy and Google sign-in; its Managed OAuth settings include ChatGPT's current redirect patterns. The bootstrap Worker currently returns `MCP_NOT_DEPLOYED` on `/mcp` and must be replaced by the application bundle from the repository.

### Manual GitHub Actions workflow

This project has a **manual-only** workflow, [`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml). It **never triggers on a push or PR**. It runs `npm run qa:local` and then `npx cf deploy --mode staging --no-provision` once when the operator requests it. This preserves the local-first QA / reduced Actions burn-rate strategy.

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

4. From **Actions → Deploy private MCP staging (manual) → Run workflow**, choose `main` and run. The job rejects missing variables, runs all tests and a Worker build, and deploys with `--no-provision` so it cannot silently create a second database. It explicitly forces `GH_APP_READONLY_ENABLED=false`, leaving GitHub read and write tools absent.
5. Once the workflow succeeds, open the staging `https://<worker-host>/health` behind Access. Complete the invited-user sign-in. An authenticated health check should return `healthy`; unauthenticated requests should encounter an Access authentication challenge.
6. Connect a **custom MCP server** in ChatGPT using `https://<worker-host>/mcp` and authenticate via Cloudflare Access Managed OAuth. Inspect `list_identities`, `identify_chat` and `get_my_tenant_id`. The identity list is expected to be **empty** until an operator registers App identities in D1.
7. Check an uninvited account, missing/expired token, and cross-session isolation. Do **not** mark [Issue #16](https://github.com/keego/github-agent-identities/issues/16) complete until a real ChatGPT connection works.

### No production token / GitHub App key required yet

Only the Cloudflare *deployment* API token is needed for this workflow. The GitHub App PEM belongs later in the private **Cloudflare Worker secrets** interface, as described in [read-only pilot setup](github-pilot-readonly.md) and [Issue #17](https://github.com/keego/github-agent-identities/issues/17). Do not share it in chat, a PR, environment variable, or repository file.

### Rollback / safety

- `cf deploy --no-provision` refuses to create missing resources rather than silently provisioning replacements.
- This workflow uses the existing `github-agent-identities-staging` Worker name; it does **not** deploy to production, alter the existing Roommate Ledger/Homelab Access apps, or make the endpoint publicly usable.
- The Cloudflare Access policy is configured independently from the Worker bundle. On a bad build, use Cloudflare Worker version rollback in the dashboard. **Do not remove Access protection** to troubleshoot.
- If GitHub Actions preflight fails, fix the workflow or API-token permissions rather than turning off the tests. Confirm the actual deploy job outcome before claiming the service is live.

See [Cloudflare staging guide](cloudflare-staging.md), [private Access setup](cloudflare-access.md), and [GitHub Agent Identities roadmap](roadmap.md).
