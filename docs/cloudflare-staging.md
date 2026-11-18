# Cloudflare staging integration (Issue #15)

> **Status: local D1 tests and private-authenticated Worker code; no live ChatGPT login or deployed MCP service verified.** Without Cloudflare Access issuer, application audience, and an invited-user allowlist, `src/worker.ts` returns HTTP **503** for MCP requests. It exposes **no GitHub write tools**.

## Layout and safety

- `cloudflare.config.ts` uses Cloudflare's `cf` CLI configuration, with separate **`github-agent-identities-staging`** and **`github-agent-identities`** Worker and D1 names.
- `DB` is the D1 binding; the existing `migrations/0001_...` and `0002_...` create conversation bindings and tenant App metadata tables.
- The old `ENABLE_UNAUTHENTICATED_DEMO` option is **ignored** by the Worker; no unauthenticated mode remains. Private MCP requires Cloudflare Access Managed OAuth, a valid signed Access assertion, exact Access audience, and an explicit invited-user allowlist. See [Access setup](cloudflare-access.md) and [#16](https://github.com/keego/github-agent-identities/issues/16).
- `MCP_PUBLIC_HOSTNAME` defaults to `unconfigured.invalid`; set the correct staging/production hostname through your deployment environment when later enabling authenticated MCP requests. Do not reuse the maintainer's personal domain by default.
- **No GitHub App PEM, JWT, installation token, or public endpoint is required for local tests.**

The project uses `cf` (current Cloudflare CLI) and `cloudflare.config.ts` rather than introducing a Wrangler config in parallel. Wrangler is installed as a build engine used by `cf`, but operators should use the `cf` commands shown below.

## Test without a Cloudflare account

Requires Node.js 22.16+ and npm:

```sh
npm install
npm run check
npm run test:d1
npm run cf:build
```

`npm run check` executes TypeScript and all tests, including the real local Cloudflare D1 integration tests through stable Miniflare/workerd. The integration tests:

- Apply both production SQL migration files to an isolated local D1 database.
- Check schema creation, distinct session/tenant binding isolation and rebinding.
- Dispose and restart the local Cloudflare runtime to verify persistence.
- Verify that writes without a migrated schema fail, and the Worker refuses MCP before authenticated setup.

The stable Miniflare v4 test harness uses the newest compatibility date supported by its pinned runtime; the **staging Worker** targets `2026-11-18`. Runtime parity beyond D1/SQL requires a subsequent full Worker smoke test in Cloudflare staging.

`npm run cf:build` bundles the staging Worker **without uploading it**. The CI workflow requires both `npm run check` and `npm run cf:build` to succeed. Neither command installs any Cloudflare credentials or changes account resources.

## Run locally with Cloudflare CLI

```sh
npm install
npx cf dev --mode staging
```

For a local Worker: `GET /health` returns HTTP 200 while `POST /mcp` returns 503 until issuer, audience, and user allowlist are provided. Without a valid signed Access assertion, `/mcp` returns HTTP 401 even with configuration present. This deliberate behavior prevents exposing an anonymous MCP service.

If you need a local D1 resource through `cf`, the CLI supports:

```sh
npx cf d1 list --local
npx cf d1 migrations apply <LOCAL_DATABASE_ID> --dir migrations --local
```

Use the actual local database ID reported by your setup; no ID is hardcoded in the reusable project. These commands are **local-only**. Keep the local state under `.cloudflare/state`, which is Git-ignored. The automated test suite also applies the same migrations to independent temporary local D1 instances.

## Remote staging: explicit operator gate

**Do not deploy a public GitHub writer until #16 authentication exists.** The following is an outline for a separate operator-owned staging environment, *not* evidence of a completed deployment:

1. Log into the intended Cloudflare account using `npx cf auth login` or an appropriately scoped CLI token, then inspect `npx cf auth whoami`. Do not commit API tokens.
2. Create a **separate staging D1 database** named `github-agent-identities-staging`, using `npx cf cli search "create a D1 database"` to discover the current account command. Record its database ID in your operator environment, not application source.
3. Apply the versioned SQL migrations to that **staging ID only**: `npx cf d1 migrations apply <STAGING_DATABASE_ID> --dir migrations`. Verify which account and database the command targets. Do not run it against a production database by accident.
4. Set the correct `MCP_PUBLIC_HOSTNAME` for the Worker hostname in your **operator environment**; run `npx cf build --mode staging` and `npx cf deploy --mode staging --dry-run` first.
5. Deploy the locked Worker using `npx cf deploy --mode staging --no-provision` **only after confirming the staging resources and intended bound database**. Verify that `/health` responds, `/mcp` remains denied, and no GitHub tools are exposed.
6. Configure [Cloudflare Access Managed OAuth](cloudflare-access.md) and verify a real ChatGPT connection under #16 before allowing trusted users to connect. Register GitHub App credentials only after that (#17).

`cf` may evolve while its 1.0 release candidate stabilizes. Check `npx cf --help` and `npx cf d1 migrations apply --help` against your installed version before targeting remote resources. The automated PR tests do **not** create a remote database, account or Worker.

## Rollback and recovery

- **Worker rollback:** Restore a previously verified Worker version using the Cloudflare dashboard/deployment controls. A code rollback does **not** roll back D1 schema or data.
- **Database recovery:** Back up D1 and use its recovery/Time Travel mechanism where available before destructive migrations. Prefer additive migrations; never assume `CREATE TABLE IF NOT EXISTS` means every future schema change is reversible.
- **Cleanup:** Delete only explicitly identified **staging** Worker/D1 resources after verifying they contain no required data. The test suite automatically removes its temporary local D1 storage.
- **Access and secrets:** At this stage the Worker is intentionally inactive; once #16/#17 is implemented, keep user OAuth secrets and GitHub App PEMs in Cloudflare's protected secrets, not the repo, D1, chat, diagnostic artifacts or issue comments.

## Pending before completing the full deployment epic

- [x] Tested real local D1 migration/persistence adapter and CI gating (#15; PR-specific CI must be green).
- [ ] Actually deploy/verify a staged Worker and D1 on an operator-owned Cloudflare account (record evidence before claiming live staging).
- [ ] [#16](https://github.com/keego/github-agent-identities/issues/16): implement authenticated user/tenant isolation across all MCP tools.
- [ ] [#17](https://github.com/keego/github-agent-identities/issues/17): provision the pilot App safely and verify a real read-only GitHub API request.
- [ ] [#5](https://github.com/keego/github-agent-identities/issues/5): demonstrate a bot-authored PR comment.
- [ ] [#18](https://github.com/keego/github-agent-identities/issues/18): test the self-hosting instructions end-to-end with another operator.

References: [Cloudflare CLI `cf` project workflow](https://developers.cloudflare.com/cf/projects/), [typed configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/), [local D1 development](https://developers.cloudflare.com/d1/best-practices/local-development/), [Miniflare D1](https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/).
