# GitHub Agent Identities — Assistant Operating Instructions

You are continuing an established software project, not starting a new one. Preserve its decisions and evidence. Read this file **before** proposing implementation steps, architectural changes, repository edits, or operational changes.

## Start-of-session bootstrap

1. Read [the current handoff](docs/AGENT_HANDOFF.md), [README](README.md), and [roadmap](docs/roadmap.md).
2. Inspect the issues, merged PR descriptions, and source files relevant to the **active milestone**. A PR's description and its actual merged code may differ; check both when needed.
3. Recover relevant decisions and rationale from earlier project conversations **when accessible**. Never imply complete access to prior chats or fabricate their contents. If a critical historical decision is missing, mark that gap explicitly.
4. Verify live operational state (deployed Worker, D1, authentication, installed tools, GitHub App permissions) **when the task depends on it**. Never infer production success from a merged PR, CI, or a stale document.
5. Reconcile conflicting evidence before recommending action. Distinguish **observed facts**, **documented intent**, **untested implementation**, and **assumptions**.

Before proceeding in a new chat, give a short alignment snapshot: product goal, decisions that constrain the work, last verified milestone, current blocker, and next acceptance test. When uncertain, explain the uncertainty instead of confidently resetting the plan.

## Continuity rules

- Preserve prior architectural and product decisions unless new evidence or an explicit user decision changes them. Record the reason for any reversal.
- Do **not** reintroduce an idea previously rejected or deliberately deferred as if it were new. Check the handoff's *Deferred* section.
- Keep infrastructure details (PEM keys, D1, Worker bindings, deployment settings) out of routine end-user workflows. For a limited pilot, distinguish **one-time operator setup** from the intended **product experience**.
- Do not ask the operator to create replacement credentials, Apps, databases, or services without verifying whether suitable ones already exist and explaining why a change is necessary.
- Do not claim a milestone complete because code merged or mocked tests passed. Verify its stated external acceptance criteria and cite the evidence.
- Do not bypass authentication, tenant isolation, GitHub installation/repository scoping, or the explicit read/write safety gates. Never put keys, tokens, private user identifiers, or raw signed assertions in Git, issues, chat, or logs.
- Prefer the smallest change toward the currently agreed milestone. Avoid duplicate setup, unnecessary GitHub Actions runs, and scope creep.
- Do not silently fall back from an App identity to a human GitHub connector. Keep authorship and permissions explicit.

## Before a PR or operational change

- State the issue and acceptance criteria. Check existing docs, merged PRs, code, and deployed config relevant to the change.
- Follow [the local-first QA playbook](docs/qa-playbook.md). Batch coherent edits, run `npm run qa:local` where execution is available, and report any limitation accurately.
- Open draft PRs during development; only mark ready when preflight and review are complete. Document real-world integration gaps separately from synthetic tests.
- For deployments or secrets, use the current operator runbook. Preserve fail-closed behavior and staging/production separation.

## End-of-session handoff

After a **substantial** development session or milestone, update `docs/AGENT_HANDOFF.md` with:
- The actual changes made, links to issue/PR/deployment evidence, and verification performed.
- Current unresolved decisions, risks, and blockers; distinguish reported evidence from assumptions.
- Next acceptance test and the smallest next action.
- Important new or revised decisions **with rationale**, including explicitly deferred work.

Do not rewrite the handoff after every trivial change. Do not mutate the handoff merely to make tests appear complete. If you cannot update it, give a concise copyable handoff in the final response.

## Sources and precedence

This file defines the **continuity process**, not the technical truth by itself. Use `docs/AGENT_HANDOFF.md` for the curated checkpoint; README, roadmap, issues, PR descriptions, and code for design/implementation evidence; and observed live tests for operational acceptance. If they disagree, surface and resolve the contradiction rather than choosing whichever supports a quick answer.
