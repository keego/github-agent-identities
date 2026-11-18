# Roadmap: from merged foundation to private pilot

**As of November 18, 2026.** All foundation PRs [#8–#13](https://github.com/keego/github-agent-identities/pulls?q=is%3Apr+is%3Aclosed) have been merged. The final integrated `main` workflow passed **35 automated tests**. These tests cover core logic, mocked GitHub and D1 calls, and SDK HTTP protocol behavior; they **do not** demonstrate a real authenticated Cloudflare deployment, a real D1 database, or an App-attributed GitHub comment.

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
| D1 binding adapter and SQL migrations | `src/d1-store.ts`, `migrations/` | Implemented; real D1 deployment/integration pending |
| Tenant-scoped App registry | `src/github-apps.ts`, `src/tenant-router.ts` | Implemented; Worker/runtime wiring pending |
| GitHub App token issuer | `src/github-auth.ts` | Mock-tested; real PEM/token exchange pending |
| GitHub PR API tools | `src/github-operations.ts`, `src/github-mcp.ts` | Mock-tested; real bot operation pending |
| Verified tenant context helper | `src/verified-tenant.ts` | Unit-tested; **trusted auth middleware that populates it does not exist yet** |
| Worker endpoint scaffold | `src/worker.ts` | **Disabled by default**; no production OAuth and no GitHub tools registered |

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
