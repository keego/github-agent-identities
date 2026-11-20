# Agent Handoff — GitHub Agent Identities

> **Latest checkpoint: November 20, 2026 — App-backed PR read succeeded.** Historical sections below contain older, superseded observations. Reconcile against live issues, code and deployment before acting.

## Product charter

**One plugin / MCP router. Multiple ChatGPT conversations. Distinct GitHub App bot identities.** An authenticated user chooses an available GitHub App identity per conversation; the router persists that choice, checks App installation and repository access, and performs GitHub actions under the selected App, not the human's personal connector.

Self-hosting is a first-class goal. The maintainer's Cloudflare instance is **private/invite-only**, not a free public relay. A potential public Plugin Directory listing is future work.

The intended **end-user** workflow is simple: connect the plugin, onboard Apps, choose an identity for a chat, and act as that bot. Any manual PEM/D1/Cloudflare setup for the **first technical pilot** is not the desired eventual product UX.

## Architectural and sequencing decisions

- One reusable MCP server; no separate MCP server or plugin for every bot role.
- Separate GitHub Apps provide independent bot attribution and repository permissions; conversations can share an App but have independent bindings.
- Use verified Cloudflare Access user identity for tenant authorization. MCP session/subject metadata only correlates conversations; it is **not** authorization.
- Keep App credentials in protected server-side secrets, and use short-lived GitHub installation tokens. Never store PEMs/tokens in D1, Git, chat, or logs.
- **Prove one complete vertical slice first:** real ChatGPT OAuth → register an existing pilot App → bind a chat → read a real PR as that App → separately approve and verify one bot-attributed PR comment.
- **GitHub App Manifest Flow was previously considered and deliberately deferred** as future onboarding/productization, not a new next step. Identity picker, self-hosting polish and public distribution are also later milestones. Do not reprioritize them without a decision.

## Verified checkpoint vs remaining gates

| Area | Evidence-backed state | Remaining acceptance |
| --- | --- | --- |
| MCP core, role binding, D1 adapter, GitHub App token/client | Implemented, CI-tested; authenticated bound Designer chat persisted and read real PR #22 | Continued regression/security checks, no GitHub writes yet |
| Cloudflare staging | Real Access-protected Worker deployed with D1, [staging run #44798464823](https://github.com/keego/github-agent-identities/actions/runs/44798464823) succeeded | Preserve Access boundary and preview-URL restrictions |
| ChatGPT OAuth / #16 | A real authenticated ChatGPT client successfully invoked `identify_chat`, `list_identities`, and `get_my_tenant_id` via the staging plugin in a session on Nov 19. `list_identities` returned an empty registry, as expected | Cross-user isolation, reconnect/refresh, revocation/negative-path live tests before closing [#16](https://github.com/keego/github-agent-identities/issues/16) |
| GitHub App pilot / #17 | **Complete.** The bound Designer chat read PR #22 with `ok:true` using App `5808833` and installation `183125278`; [#17](https://github.com/keego/github-agent-identities/issues/17) closed | Keep repo allowlist and secret controls, no human connector fallback |
| GitHub write / #5 | Mock-tested operations exist, but authenticated Worker deliberately does **not** register write tools | Separate review, explicit harmless test comment, and observed author ending in `[bot]`. [#5](https://github.com/keego/github-agent-identities/issues/5) |

**Historical staging note (Nov 19, superseded):** The Worker initially exposed only identity tools and had no GitHub App registry or private-key binding. These changed before Nov 20's successful read. The current staging path is read-only enabled, with no bot-write tool registered. Do not regenerate keys based on the obsolete initial state.

## Next milestone

Finish [#16 — authenticated two-human and revocation acceptance](https://github.com/keego/github-agent-identities/issues/16) before the separately gated [#5 — first bot-authored PR comment](https://github.com/keego/github-agent-identities/issues/5). Real App-backed PR reads work, but a single owner ChatGPT session is **not** proof of cross-user isolation or live token revocation. A second independently invited human is required for live #16 acceptance. **Do not enable comment writes until the separate #5 authorization and test gate.**

## Deliberately deferred

- GitHub App Manifest Flow and streamlined create/import UI: future product onboarding, after the first live App proof.
- Graphical identity picker and rebinding polish: [#7](https://github.com/keego/github-agent-identities/issues/7).
- Executable public self-hosting runbook: [#18](https://github.com/keego/github-agent-identities/issues/18).
- Public listing/domain/distribution options: [#1](https://github.com/keego/github-agent-identities/issues/1).

## Known documentation drift / pitfalls

- README and operator docs were refreshed after the first single-user authenticated tool-call smoke. This does **not** establish completion of #16's multi-user and revocation acceptance.
- Earlier dated snapshots and issue comments may still describe an undeployed Worker or disabled App reads. Current staging is deployed, and the read-only App call succeeded live; always distinguish historic text from live evidence.
- A connected GitHub App **installation** and a router-configured **credential/identity record** are different. Do not equate App existence with a working installation-token exchange.
- The first pilot's manual credential provisioning is an intentional technical milestone, **not** the eventual zero-friction end-user onboarding UX.

## Fresh conversation bootstrap

Read [`AGENTS.md`](../AGENTS.md) first. Then verify the issue/PR/deployment state rather than simply repeating this snapshot. Summarize the verified status and deferred decisions before recommending action. If you can access earlier conversations, recover their rationale; if not, state the limit rather than inventing a history.

## November 19 staging deployment troubleshooting (issue #17)

- The first read-only pilot workflow run [#44611396081](https://github.com/keego/github-agent-identities/actions/runs/44611396081) passed 46 tests but was stopped by `cf` configuration drift (the intentional read-only toggle and D1-name metadata); no upload occurred.
- A guarded override was added in PR #32, but the second run [#44615950531](https://github.com/keego/github-agent-identities/actions/runs/44615950531) failed **before deployment** because newly authored multi-line `curl` shell had doubled continuation backslashes; `--header` was interpreted as a command. There is no evidence of compromised Access, missing PEM or damaged D1.
- Replace inline shell pre/post config verification with a Node verifier and regression tests; keep the override checkbox default-off and preserve strict binding/secret/D1 checks. **Do not repeat the live deploy until this fix passes local tests and CI**. The intended next external acceptance remains a read-only authenticated App PR read; never enable comment writes under #17.

## November 19 — Live bound App read returned INTERNAL_ERROR

- After PR #33 and successful staging deployment, the test chat could discover `github_get_pull_request` and remained bound to UI/UX Designer. The first read of `keego/poster-brain` PR #22 returned `INTERNAL_ERROR`. No PR contents were retrieved, and no write took place.
- The staging configuration, D1 identity record and chat binding were independently verified. The generic error was **not enough to determine the actual failed stage**; `github-mcp.ts` masks unexpected errors, including authentication errors thrown as plain `Error` by `github-auth.ts`.
- Introduce **sanitized, typed stage errors** for missing Worker secret, local App-JWT signing, GitHub installation-token exchange, invalid token, and App registry retrieval. Preserve no-sensitive-data-in-tool-output behavior; do not expose JWTs/PEMs/tokens, raw GitHub responses or user emails.
- Next: merge/test diagnostic change, deploy with reviewed read-only path, re-run the bound PR #22 read. Confirm installation/repository access if the stage is installation exchange or GitHub HTTP. Do not treat #17 or #16 as complete.


## November 20 — PKCS#1 signing compatibility (PR #35)

- The first live bound `github_get_pull_request` attempt after PR #34 returned `APP_JWT_SIGNING_FAILED`, **before installation-token exchange**. This narrows the observed failure to local signing, not GitHub repository authorization.
- GitHub provides App private keys as PKCS#1 PEM, while WebCrypto requires PKCS#8. The Worker bundle's crypto module selection can differ from Node unit tests. Introduce an in-memory PEM normalization/conversion with `node:crypto.createPrivateKey`, validate RSA, and preserve sanitized error handling (`APP_KEY_FORMAT_INVALID` vs `APP_JWT_SIGNING_FAILED`). Never expose the PEM/JWT.
- Add synthetic PKCS#1→PKCS#8/WebCrypto signing tests and a Miniflare Worker crypto check. Next: independent CI, then manual staging deploy if reviewed; retry bound PR #22 read and record the actual result. Do not assume this is the root cause until the live test passes.


## November 20 — Real installation token acquired; PR request still denied/unresolved

- The already-bound Designer chat's `github_get_pull_request` call for `keego/poster-brain` PR #22 returned `GITHUB_REQUEST_FAILED` after successful PR #35 staging deployment. This code proves the JWT signing and installation-token exchange passed, but does not establish which upstream HTTP status occurred (including possible network transport errors).
- A separate human GitHub connector successfully read that PR's metadata and confirmed it exists/open. **This does not prove the App installation can access it.** The human connector cannot query installation ID `183125278` with its own credentials (403).
- Classify fixed GitHub HTTP status codes (401/403/404/429/400/422/5xx) in the MCP read operation without returning raw response bodies, headers or tokens. Distinguish 404's missing-vs-hidden ambiguity, and preserve generic errors on network failure. Add mock tests. Keep #17 open and no writes registered.


## November 20 — One-shot read-only diagnostics (extended PR #36)

- After user feedback about iterative live-debug churn, expand PR #36 to include **bounded, automatic, read-only** follow-up probes after a failed App-authenticated PR request (repo metadata GET and installation repository-list GET).
- Return PR request kind/status, repo visibility status, installation-list status and a tri-state repo-selection result. Never surface raw headers/bodies, tokens or other repo names.
- A missing repository on a partial list is **unknown**, not proof of removal. All probes occur only after signed tenant authentication, conversation binding, repo allowlist, and token issuance. No additional GitHub write permissions or MCP tool-refresh steps.
- PR #36 CI must test 403/404/transport/invalid JSON, scope listing completeness, denial before probes, and zero extra probes on success. Existing screenshot establishes configured App permissions and repo selection; do not ask the user to repeat that check. Distinguish configured selection from live installation-token access.


## November 20 — GitHub outbound fetch: Worker native receiver bug (#17)

- The real bound Designer PR #22 read after successful PR #36 deployment returned `GITHUB_REQUEST_FAILED`, `pullRequest.kind="transport"`, and `null` HTTP statuses for both read-only probes. This indicates no usable HTTP responses from our own GitHub HTTP client. The prior `APP_INSTALLATION_TOKEN_FAILED` stage had been passed: Octokit already successfully exchanged the App JWT for an installation token.
- Verified source has `GitHubOperations` storing unbound Worker-global native `fetch` as an instance property (`httpFetch = fetch`) and calling `this.httpFetch(...)`. Cloudflare Worker native fetch requires the correct receiver; calling it from an unrelated class instance raises `TypeError: Illegal invocation`, a known Cloudflare runtime pattern (https://github.com/cloudflare/workerd/issues/6904).
- Fix by wrapping the native invocation (`(input, init) => fetch(input, init)`) to preserve the global receiver and fake-client injection. Test the **actual Workerd/Miniflare runtime** with mocked outbound GitHub GET: the old property invocation must fail with TypeError and the wrapped version must return the mocked 200. This avoids a live GitHub call and does not depend on real PEMs.
- Next: reviewed PR and green CI before a single manual staging redeploy. In the existing bound Designer chat, retry the App's PR read. Keep #17 open until an App-authenticated read and negative tests pass. No App permissions, secrets, D1, Cloudflare Access, or write-tool changes.


## November 20 — #17 real App read succeeded; #16 live isolation next

- Operator pasted the separate authenticated Designer chat's staging `github_get_pull_request({repository:"keego/poster-brain",number:22})` result: `ok:true`, PR title/state/author/body returned, no writes. PR #37 merged and [staging deployment #44798464823](https://github.com/keego/github-agent-identities/actions/runs/44798464823) succeeded at `314b4dc757b9c0085e3a3215ec7bb3d2010fba60`. #17 was already closed when checked; [acceptance comment](https://github.com/keego/github-agent-identities/issues/17#issuecomment-7048605586).
- The current goal is to finish #16 before enabling #5 GitHub writes. The current owner-only staging Access configuration has **not** been shown to support two independently authenticated humans. Full live two-user isolation, OAuth reconnect/refresh and revocation have **not** been established and must not be claimed as passed.
- A focused #16 regression PR extends the existing signed-JWT + real MCP transport tests for same-user reconnect with a new assertion, independent Access subjects even if email/metadata match, effective Worker allowlist revocation, expired/wrong-audience access, and disjoint GitHub read permissions. Add a safe two-human operator runbook, with no invitation or secrets modified and no write tools registered.
- The next external gate needs an explicitly invited second human in **both** Cloudflare Access policy and Worker email allowlist. A second human with no App registry entries is sufficient to prove absence of cross-tenant enumeration. No account provisioning or credential sharing occurs automatically.

## November 20 — PR #40 draft: owner-only single GitHub App comment pilot (#5)

- After #17's successful real App-backed read and merged #38's green two-tenant regressions, the user agreed to **defer #16 live second-user testing** until an actual second person joins. #16 stays open; no invented live multi-user acceptance.
- [PR #40](https://github.com/keego/github-agent-identities/pull/40) implements a separate default-off *one-owner, one-PR* GitHub comment pilot with fixed harmless text and explicit confirmation input. The authenticated bound App and per-App repo allowlist still control the token. It is **not** a general comment writer. Adding more invited humans disables the pilot. No write tool is registered without all independent gates.
- New additive `0003_pilot_comment_attempts.sql` migration creates a unique owner/repo/PR claim. An attempted POST is claimed only after successful App-token issuance, **before network dispatch**. Unknown write outcomes block replays. A successful GitHub response records comment ID/URL/author; return actual `botAttributed` status, never assume.
- Manual staging deployment has a new explicitly false-by-default write checkbox, owner/target configuration from protected environment settings and strict pre/post metadata checks. The **first deployment should keep write disabled**. Do not apply migration/deploy/activate or send a real comment without reviewing current source/CI and the exact operator approval. See [full operator runbook](github-comment-pilot.md).
- Next: finish PR QA/CI and review; merge only after passing checks. Operator selects an appropriate test PR, applies migration in staging, approves exact text/target and manually activates pilot. Observe bot-authored comment, then disable flag, audit and close #5. Keep #16 live acceptance pending and no multi-user writes.


## November 20 — second independent development App (Sandbox) onboarding

- User approved creating a **dedicated GHAI Sandbox Bot** installed only on `keego/github-agent-identities` to dogfood new GitHub operations without polluting Poster Brain. Preserve the existing bound Designer App and `keego/poster-brain` working read baseline. Do not reassign/reuse Designer App for the new repository.
- Operator-created App not yet provisioned in this repository work session; the user will register/install it, generate a distinct PEM and add protected Cloudflare **`GH_APP_SANDBOX_PRIVATE_KEY`**. No credentials or IDs fabricated. [New operator onboarding runbook](github-sandbox-app.md) includes exact permissions, installation, separate D1 identity `ghai-sandbox`, safe read/deny checks, and later #5 one-shot comment.
- Staging verifier is being updated to accept the second App's **optional, protected** secret binding with strict name/type validation and no secret reading, while preserving the existing Designer secret requirement and current pilot-write default-off rules. Add two-App routing/token isolation tests; no runtime GitHub writes or Cloudflare secret/D1 changes in source PR.
- PR #40 merged before this onboarding, but no real bot-comment write has been observed. Keep #5 open; #16 two-human live acceptance is intentionally deferred/open. Next external gate: operator provides **only App ID + Installation ID**, while private PEM remains in Cloudflare, then operator-controlled D1 onboarding and two-App read isolation smoke tests.

## November 20 — Sandbox App registered; protected Cloudflare key still pending

- Operator reports **GHAI Sandbox Bot** created and installed only on `keego/github-agent-identities`: real **App ID `5855759`**, **installation ID `184190090`** (nonsecret). [PR #41](https://github.com/keego/github-agent-identities/pull/41) has merged at `c1bb7e055c015c7dc79f893ebcf9e4b8f472e952`, enabling an optional second protected staging secret binding and two-App isolation tests.
- Cloudflare connector **metadata-only** check of `github-agent-identities-staging` on Nov 20 confirmed `GH_APP_DESIGN_PRIVATE_KEY` remains a `secret_text` binding, but **`GH_APP_SANDBOX_PRIVATE_KEY` was absent**. Read-only flag remained `true`; the new comment-pilot flag was **not configured/active** in deployed settings. Do not retrieve key values, write a tenant D1 row, enable comments or claim a Sandbox read succeeded yet.
- GitHub's October 2, 2026 changelog confirms ~520-character `ghs_APPID_JWT` stateless installation tokens already rolled out; temporary override header expires November 30, 2026. Existing `InstallationTokenProvider` has no token length or prefix checks and keeps tokens opaque. Synthetic legacy/new-format regression was added with actual Sandbox App/installation identifiers in tests and the onboarding runbook. No live stateless-token read is yet verified.
- Next: operator privately adds `GH_APP_SANDBOX_PRIVATE_KEY` to **staging** Worker; verify protected binding name/type only; select the actual signed tenant privately and insert the distinct `ghai-sandbox` D1 identity (no replacement of Designer row). Use one read-only staging deployment; first read a PR as Sandbox and validate mutual cross-repo denials. Keep bot-comment pilot disabled until a separate explicit approval of exact target/text (#5).
