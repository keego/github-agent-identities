# Roadmap: from merged foundation to private pilot

**As of November 19, 2026.** Foundation and private-pilot PRs through [#29](https://github.com/keego/github-agent-identities/pull/29) are merged. [Staging deployment 44378420871](https://github.com/keego/github-agent-identities/actions/runs/44378420871) passed **46 tests** and deployed the Worker and D1 binding; a later [deploy run](https://github.com/keego/github-agent-identities/actions/runs/44454364758) observed HTTP 401 for anonymous `/health`. On November 19 a real authenticated ChatGPT client invoked `identify_chat`, `list_identities` and `get_my_tenant_id`. **This single-user smoke test does not close #16.** No live GitHub App PR read or bot write is verified.

## Live staging checkpoint

- **Provisioned and verified:** isolated Cloudflare D1 schema, owner-only Access application with Managed OAuth, TypeScript MCP Worker deployed on the staging `workers.dev` hostname, and 46 passing CI tests.
- **D1 onboarding state:** At the November 18 D1 inspection there were zero App rows and chat bindings; November 19's authenticated `list_identities` still showed no Apps. The binding-row count was not subsequently rechecked.
- **Security hardening:** Preview URLs are disabled in source. The manual deploy's anonymous `/health` probe observed HTTP 401 in [run 44454364758](https://github.com/keego/github-agent-identities/actions/runs/44454364758); this proves denial for that probe, not complete OAuth acceptance.
- **Remaining #16 gate:** After the first signed-user tool smoke test, verify two authorized users' isolation, invitation denial, reconnect/refresh, revocation and authenticated chat binding persistence.
- **Blocked on operator secret:** GitHub App PEM must be installed directly as a Cloudflare Worker secret before read-only #17 verification; no PEM or installation token has been placed in GitHub or chat.
- **Do not close #16/#17:** the source code and infrastructure exist, but their live acceptance gates remain open.

## Implementation order

| Order | GitHub issue | Deliverable | Release/verification gate |
| --- | --- | --- | --- |
| 1 | [#15 — Worker + D1 integration](https://github.com/keego/github-agent-identities/issues/15) | Wrangler config, migrations, real local D1 tests, staging smoke-testable Worker, safe default lockout | Bind/rebind survives separate requests and a process restart; unauthenticated GitHub writes remain unavailable |
| 2 | [#16 — Authenticated private MCP](https://github.com/keego/github-agent-identities/issues/16) | ChatGPT-compatible OAuth, real user identity, allowlist, per-tenant authorization of **all** MCP tools | Uninvited and spoofed users denied; different users have disjoint identities/bindings |
| 3 | [#17 — GitHub App pilot wiring](https://github.com/keego/github-agent-identities/issues/17) | Secure App key secret, tenant-owned identity registry, installation-token exchange, read-only live GitHub call | App `5808833` / installation `183125278` relationship and repo selection verified through GitHub; authorized ChatGPT call reads a PR |
| 4 | [#5 — First real bot-attributed comment](https://github.com/keego/github-agent-identities/issues/5) | One explicit test PR comment through a bound chat | GitHub author is the expected App `[bot]`, not a personal connector; unauthorized calls create no comment |
| 5 | [#18 — Self-hosting operator guide](https://github.com/keego/github-agent-identities/issues/18) | Executable setup/upgrade/backup/rotation/revocation instructions for a separate operator-owned instance | A second developer can deploy their own instance without any access to the maintainer's hosted service |
| Follow-up | [#7 — Picker and rebinding UX](https://github.com/keego/github-agent-identities/issues/7) | Human-friendly identity choices; real dropdown if host supports it; expired session recovery | Verify live ChatGPT selection and persistence; fallback remains accessible |
| Future | [#1 — Public Plugin Directory](https://github.com/keego/github-agent-identities/issues/1) | Research listing and per-user endpoint options; optional project domain | Independent of private pilot; no obligation to operate free public hosting |

Parent deployment epic: [#6 — Private Cloudflare service](https://github.com/keego/github-agent-identities/issues/6). The table expresses implementation dependencies; #18 may be drafted in parallel, but its commands cannot be called tested until #15–#17 pass.

## Existing building blocks (merged, tested in CI)

| Component | Current location | State |
| --- | --- | --- |
| MCP chat identification and identity binding | `src/core.ts`, `src/server.ts`, `src/request-context.ts` | Implemented; real MCP client/server test |
| In-memory adapter | `src/core.ts`, `src/local.ts` | Local-only demo; not durable |
| D1 binding adapter and SQL migrations | `src/d1-store.ts`, `migrations/` | Local D1 tests pass; staging D1 migrated/bound; authenticated chat persistence not yet proven |
| Tenant-scoped App registry | `src/github-apps.ts`, `src/tenant-router.ts` | Implemented and wired into authenticated Worker; no Apps yet configured for staging tenant |
| GitHub App token issuer | `src/github-auth.ts` | Mock-tested; real PEM/token exchange pending |
| GitHub PR API tools | `src/github-operations.ts`, `src/github-mcp.ts` | Mock-tested; real bot operation pending |
| Verified tenant context helper | `src/verified-tenant.ts`, `src/access-auth.ts`, `src/worker.ts` | JWT-verifying Worker auth boundary implemented; initial live client calls observed; #16 negative paths still pending |
| Worker endpoint scaffold | `src/worker.ts` | Staging deployed and Access protected; single-user ChatGPT tools observed; GitHub reads forced off in manual deploy |

## Credentials and configuration boundary

The user has supplied these **public** pilot identifiers (not authentication secrets):

- Registered App: **Poster Brain - UI/UX Designer**
- GitHub App ID: `5808833`
- Installation ID: `183125278`
- Intended allowed repository: `keego/poster-brain` (**installation access unverified until an authenticated GitHub call**)

A GitHub installation ID identifies an installation on a user/organization account, not a chat. The private key is a different credential, and **must be generated and installed in the hosting platform's protected secret manager**; never request it in a chat or persist it in Git/D1. See [GitHub App setup](github-app-setup.md).

## Private hosting and open-source distribution

The first deployment is **private/invite-only** for the maintainer and trusted people. It may have a public HTTPS address, but access must be authenticated and restricted. Other developers should **self-host their own MCP endpoint and App credentials**. Do not expose an anonymous GitHub writer or assume an operator's private instance is a public SaaS service.

Use `workers.dev` for the pilot. Buying a new domain, publishing in the Plugin Directory, and deciding whether a directory listing can accept customer-specified endpoints are **deferred**, not abandoned.

## Scope boundaries and testing honesty

- **CI success** validates the checked-in code and tests, not a provisioned Worker, live D1, ChatGPT OAuth, or real GitHub attribution.
- **Open GitHub issues are intentional.** The merged PRs implemented scaffolding; #5, #6, and #7 are not complete until their external acceptance tests pass.
- **Auth is mandatory** for every exposed MCP operation. Chat session identifiers correlate calls; OAuth `clientId` identifies a client application, **not** the human account. The trusted authentication boundary must establish the actual principal.
- **Fail closed.** Missing identity, missing authorization, absent App install, invalid key/token or unapproved repository must not silently select another identity or fall back to the human GitHub connector.

## PR and QA expectations

For each new PR: link the corresponding issue, state acceptance criteria and limitations, add synthetic negative-path regression tests, pass **truthful** CI (no swallowed exit statuses), and document real integration evidence separately. Keep features in dependency order and merge only after the relevant tests pass. No credentials or token-bearing request logs in issues, screenshots, or CI artifacts.
