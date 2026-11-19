# Development and verified staging status

**As of November 18, 2026:** the real TypeScript MCP Worker is deployed to a **private, Access-protected staging hostname** using [manual GitHub Actions run 44378420871](https://github.com/keego/github-agent-identities/actions/runs/44378420871). The run passed **46/46 tests** and the Cloudflare staging build, then deployed Worker version `28957b9e-c62a-4c1c-a625-9f8a5d61b9dd`. The D1 binding and signed Access application configuration were independently verified with Cloudflare's API.

**Still unverified:** a real ChatGPT Managed OAuth callback/login, signed assertion from that flow, tool discovery and per-conversation binding, user invitation denial and token revocation, live GitHub App installation-token exchange, and bot-attributed GitHub writes. A successful deployment and synthetic tests are not proof of those user-facing behaviors.

## Local-first QA

Use Node.js 22.16+ and npm:

```sh
npm install --no-audit --no-fund
npm run qa:local
npm run dev:local
```

`qa:local` runs TypeScript checking, the full `tsx` test suite (including Miniflare's actual local D1), and the staging Worker build. The local `src/local.ts` server at `127.0.0.1:8787/mcp` is an **identity-only in-memory demo**, not the Cloudflare OAuth service.

For inexpensive iterative checks use `npm run typecheck`, `npm test` and `npm run test:d1`. Keep PRs in draft until local QA is complete, batch source changes, and run final CI once when ready. See [QA playbook](qa-playbook.md). A committed npm lockfile and `npm ci` are still tracked under [#24](https://github.com/keego/github-agent-identities/issues/24).

## Verified components and boundaries

| Concern | Implementation | Verification |
| --- | --- | --- |
| Conversation identity / binding | `src/core.ts`, `src/server.ts`, `src/request-context.ts` | SDK HTTP and negative-path tests; real ChatGPT metadata pending |
| Local persistent D1 adapter | `src/d1-store.ts`, `migrations/` | Actual local Miniflare D1 schema, isolation and restart tests; staging Cloudflare D1 created and bound |
| Private signed user authentication | `src/access-auth.ts`, `src/worker.ts` | Synthetic signed-JWT tests and two-user isolation; *real* Managed OAuth still pending |
| GitHub App registry and token provider | `src/github-apps.ts`, `src/github-auth.ts`, `src/tenant-router.ts` | Mocked token issuance and allowlisting; App PEM and live read pending |
| GitHub MCP PR read | `src/github-mcp.ts`, `src/github-operations.ts` | Read-only tool integration tests; disabled in deployed staging until operator opt-in |
| Cloudflare Worker / Access | `src/worker.ts`, `cloudflare.config.ts` | Actual Worker deployed and Access app configured; live browser/client auth pending |
| App-authored comments | Future #5 | Deliberately absent from staging's registered MCP tools |

MCP client `_meta` fields correlate a conversation, **not** an authenticated person. Production tenant identity is derived from a cryptographically verified Access JWT's `sub`; neither OAuth `clientId`, MCP `openai/session` nor an arbitrary request header can establish tenancy.

## Private pilot handoff

1. Verify a real OAuth sign-in from ChatGPT to `https://github-agent-identities-staging.keegansfarley.workers.dev/mcp` (owner must consent/sign in). See [staging runbook](live-staging-deployment.md) and [Access setup](cloudflare-access.md).
2. Call `get_my_tenant_id` after sign-in and compare the verified tenant with the expected owner in a private operator channel. Do not guess the JWT `sub` or put raw tokens in issues.
3. Add one operator-approved App identity to D1 with **public App and installation IDs only**, and put its PEM in a **Cloudflare Worker secret**, not D1/GitHub/ChatGPT. See [read-only App pilot](github-pilot-readonly.md).
4. Enable the read-only GitHub tool only after auth is validated. Verify a PR read, then separately review the write gate under [#5](https://github.com/keego/github-agent-identities/issues/5).
5. Keep the full unauthorized-access, invitation-revocation and recovery tests as open acceptance gates under [#16](https://github.com/keego/github-agent-identities/issues/16).

## Security cautions

The staging Worker is *not* a publicly usable MCP. Its real endpoint exists but is intended only for Access-authorized users. Keep `GH_APP_READONLY_ENABLED=false` until the live sign-in and the installation setup pass. Explicitly disable preview/version URLs (`previewUrls: false`), verify anonymous requests are denied, and never print PEM, JWT, installation tokens, Cloudflare API tokens, or invitee lists in logs or public artifacts.
