# Agent Handoff — GitHub Agent Identities

> **Checkpoint: November 19, 2026.** This file is a concise continuity anchor, not a substitute for checking current GitHub issues, source, deployment, or actual test results. Keep operational facts dated and verified.

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
| MCP core, role binding, D1 adapter, GitHub App token/client | Implemented; synthetic tests + local D1 CI. See [README](../README.md), [roadmap](roadmap.md) and merged PRs | Real end-to-end App calls, persistence in authenticated chats |
| Cloudflare staging | Real Worker deployed and D1 bound; [manual deploy](https://github.com/keego/github-agent-identities/actions/runs/44378420871) reported 46 passing tests | Keep Access boundary and preview-URL restrictions intact |
| ChatGPT OAuth / #16 | A real authenticated ChatGPT client successfully invoked `identify_chat`, `list_identities`, and `get_my_tenant_id` via the staging plugin in a session on Nov 19. `list_identities` returned an empty registry, as expected | Cross-user isolation, reconnect/refresh, revocation/negative-path live tests before closing [#16](https://github.com/keego/github-agent-identities/issues/16) |
| GitHub App pilot / #17 | Existing **Poster Brain - UI/UX Designer** App: App ID `5808833`; user-confirmed installation ID `183125278`; proposed allowed repo `keego/poster-brain`. Source implements read-only tool behind opt-in | Confirm installation/repo access; provision App key in Worker secret; add tenant-scoped D1 identity; enable read-only tool; observe real PR read. [#17](https://github.com/keego/github-agent-identities/issues/17) |
| GitHub write / #5 | Mock-tested operations exist, but authenticated Worker deliberately does **not** register write tools | Separate review, explicit harmless test comment, and observed author ending in `[bot]`. [#5](https://github.com/keego/github-agent-identities/issues/5) |

**Operational notes (verify before acting):** Staging has exposed only identity tools; an observed `list_identities` response was empty. The [manual staging deployment workflow](../.github/workflows/deploy-staging.yml) explicitly forces `GH_APP_READONLY_ENABLED=false`. A November 19 inspection found no GitHub App PEM secret bound to staging. These are not evidence of a defective OAuth integration. The operator reported never downloading a GitHub App PEM; do not assume one exists or casually generate/rotate keys without first checking actual credential requirements.

## Next milestone

Continue [#17 — authenticated read-only GitHub App pilot](https://github.com/keego/github-agent-identities/issues/17), respecting the current workflow's safe defaults. Verify the existing App/installation permissions and credential availability, provision only what is actually needed, register the existing Designer identity for the verified tenant, enable the read-only tool through a reviewed deployment change, then read a real PR. **Do not open GitHub write access before the separate #5 gate.**

## Deliberately deferred

- GitHub App Manifest Flow and streamlined create/import UI: future product onboarding, after the first live App proof.
- Graphical identity picker and rebinding polish: [#7](https://github.com/keego/github-agent-identities/issues/7).
- Executable public self-hosting runbook: [#18](https://github.com/keego/github-agent-identities/issues/18).
- Public listing/domain/distribution options: [#1](https://github.com/keego/github-agent-identities/issues/1).

## Known documentation drift / pitfalls

- README and operator docs were refreshed after the first single-user authenticated tool-call smoke. This does **not** establish completion of #16's multi-user and revocation acceptance.
- Earlier dated snapshots and issue comments may still describe an undeployed Worker or unwired App reads. Current staging is deployed, and App read code is wired behind a disabled flag; always distinguish historic text from live evidence.
- A connected GitHub App **installation** and a router-configured **credential/identity record** are different. Do not equate App existence with a working installation-token exchange.
- The first pilot's manual credential provisioning is an intentional technical milestone, **not** the eventual zero-friction end-user onboarding UX.

## Fresh conversation bootstrap

Read [`AGENTS.md`](../AGENTS.md) first. Then verify the issue/PR/deployment state rather than simply repeating this snapshot. Summarize the verified status and deferred decisions before recommending action. If you can access earlier conversations, recover their rationale; if not, state the limit rather than inventing a history.
