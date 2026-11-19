# Development and verified staging status

**Deployment verified November 18, 2026; auth smoke observed November 19.** The real TypeScript MCP Worker was deployed to private Access-protected staging using [manual run 44378420871](https://github.com/keego/github-agent-identities/actions/runs/44378420871), which passed **46/46 tests** and the Worker bundle. Its staging D1 binding and owner-only Access policy are configured.

**Observed November 19:** An authenticated ChatGPT client invoked `identify_chat`, `list_identities` and `get_my_tenant_id`; the App registry was empty. **Still unverified in live acceptance:** a second authorized user, invitation denial, reconnect/refresh, revocation, authenticated chat binding persistence, real GitHub App installation-token PR read and bot writes. See [handoff](AGENT_HANDOFF.md) and [#16](https://github.com/keego/github-agent-identities/issues/16).

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
| Conversation identity / binding | `src/core.ts`, `src/server.ts`, `src/request-context.ts` | SDK HTTP/negative-path tests; authenticated ChatGPT identity-tool calls observed, live binding persistence still pending |
| Local persistent D1 adapter | `src/d1-store.ts`, `migrations/` | Actual local Miniflare D1 schema, isolation and restart tests; staging Cloudflare D1 created and bound |
| Private signed user authentication | `src/access-auth.ts`, `src/worker.ts` | Synthetic signed-JWT tests and two-user isolation; single-user live smoke observed, full #16 acceptance pending |
| GitHub App registry and token provider | `src/github-apps.ts`, `src/github-auth.ts`, `src/tenant-router.ts` | Mocked token issuance and allowlisting; App PEM and live read pending |
| GitHub MCP PR read | `src/github-mcp.ts`, `src/github-operations.ts` | Read-only tool integration tests; disabled in deployed staging until operator opt-in |
| Cloudflare Worker / Access | `src/worker.ts`, `cloudflare.config.ts` | Staging Worker and Access deployed; anonymous `/health` rejected in subsequent manual deployment; first authenticated client calls observed |
| App-authored comments | Future #5 | Deliberately absent from staging's registered MCP tools |

MCP client `_meta` fields correlate a conversation, **not** an authenticated person. Production tenant identity is derived from a cryptographically verified Access JWT's `sub`; neither OAuth `clientId`, MCP `openai/session` nor an arbitrary request header can establish tenancy.

## Private pilot handoff

1. First authenticated ChatGPT identity-tool smoke observed November 19. Verify two-user isolation, reconnect/refresh, revocation and denial checks before declaring #16 complete. See the [staging runbook](live-staging-deployment.md).
2. Call `get_my_tenant_id` after sign-in and compare the verified tenant with the expected owner in a private operator channel. Do not guess the JWT `sub` or put raw tokens in issues.
3. Add one operator-approved App identity to D1 with **public App and installation IDs only**, and put its PEM in a **Cloudflare Worker secret**, not D1/GitHub/ChatGPT. See [read-only App pilot](github-pilot-readonly.md).
4. Enable the read-only GitHub tool only after auth is validated. Verify a PR read, then separately review the write gate under [#5](https://github.com/keego/github-agent-identities/issues/5).
5. Keep the full unauthorized-access, invitation-revocation and recovery tests as open acceptance gates under [#16](https://github.com/keego/github-agent-identities/issues/16).

## Security cautions

The staging Worker is *not* a publicly usable MCP. Its real endpoint exists but is intended only for Access-authorized users. Keep `GH_APP_READONLY_ENABLED=false` until the live sign-in and the installation setup pass. Explicitly disable preview/version URLs (`previewUrls: false`), verify anonymous requests are denied, and never print PEM, JWT, installation tokens, Cloudflare API tokens, or invitee lists in logs or public artifacts.
