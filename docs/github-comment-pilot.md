# First bot-attributed PR comment — one-owner staging pilot (#5)

> **Not live/approved yet.** This is a reviewable implementation for an *explicitly authorized* test comment. Merging or an ordinary staging deploy MUST NOT enable GitHub writes. #16's live two-human acceptance is deferred and stays open; the pilot intentionally supports just one invited owner.

## Exact action and safeguards

- MCP tool: `github_post_pilot_comment`. The existing `github_get_pull_request` remains read-only. **No general `github_comment_on_pr` or arbitrary GitHub writer is registered.**
- Comment body is compiled into the server (not a tool argument): `GitHub Agent Identities staging smoke test: this comment was posted by the GitHub App identity bound to an authenticated ChatGPT conversation. No action required.`
- Required tool arguments: `repository`, `number`, and `confirmation: "POST_APPROVED_PILOT_COMMENT"`. That string is a software safety check, **not** proof of human consent; obtain a separate, explicit human approval in the bound conversation for this exact message and PR first. Do not auto-call the writer after approval to merge/deploy.
- The Worker must receive **all** of: `GH_APP_READONLY_ENABLED=true`, `GH_APP_COMMENT_PILOT_ENABLED=true`, a validated, signed Cloudflare Access user whose opaque tenant ID exactly matches the operator's configured owner, *exactly one* invited email on the Worker allowlist, the operator's exact target repo/PR, and a bound GitHub App that itself authorizes that repo.
- The write tool is not even listed to other/unauthorized tenants or when any configuration is absent; a mismatched repo/PR, unbound chat, invalid confirmation, or missing GitHub App secret refuses the request before a POST.
- D1 migration `0003_pilot_comment_attempts.sql` creates a unique key on `(tenant_id, repository, pr_number)`. **After** obtaining an App token but **before** the HTTP POST, a D1 `INSERT OR IGNORE` must atomically confirm the first attempt. Failure or duplicate denies POST. A GitHub transport/HTTP/JSON error leaves the attempt claimed because the comment may have posted even if the response failed. Never automatically retry.
- On success the D1 row records the GitHub comment ID, URL and author; no comment body, PEM, tokens, JWTs, OAuth credentials or raw ChatGPT session IDs are stored. The returned `botAttributed` boolean checks whether GitHub's actual `user.login` ends in `[bot]`; separately verify the exact expected bot in GitHub.

## Operator staging checklist — *only after review and explicit approval*

1. Merge the reviewed implementation only after full CI including D1/MCP/Worker tests passes. An ordinary staging deployment with `enable_github_app_pilot_comment` **unchecked** adds default-off bindings while preserving Access, the existing App secret and the verified read-only pilot. Nothing should post merely because this PR merges.
2. Select an appropriate **test PR** in the App-authorized `keego/poster-brain` repository. Avoid an active feature/design review PR if a temporary test comment would be distracting. Record the exact repo, PR number, and the fixed message above. The human explicitly approves posting **that** message on **that** PR.
3. Apply the additive migration to the **staging D1 only**, using the existing [Cloudflare staging runbook](cloudflare-staging.md) and the actual staging database ID (never guess a database). For example, from a reviewed checkout with configured Cloudflare credentials: `npx cf d1 migrations apply <STAGING_DATABASE_ID> --dir migrations`. Verify `pilot_comment_attempts` exists; neither initial D1 data nor existing bindings should change.
4. Set operator-only GitHub Actions **staging environment** settings, *without placing values in source, issues, or chat*: secret `GH_APP_COMMENT_PILOT_OWNER_TENANT_ID` (the opaque value from the authenticated owner's `get_my_tenant_id`), variables `GH_APP_COMMENT_PILOT_REPOSITORY` and `GH_APP_COMMENT_PILOT_NUMBER`. Never store App PEMs in GitHub Actions.
5. Manually dispatch **Deploy private MCP staging** on `main` with `takeover_api_bootstrap=false`, `enable_github_app_reads=true`, `enable_github_app_pilot_comment=true`, and `approve_verified_config_override=true`. The workflow verifies exactly one invited email, owner/target/repo/PR configuration, the existing App secret *name*, D1 and Worker binding metadata, and anonymous Access denial. An invalid setting fails **before uploading**. Do not widen the Access allowlist to test the writer.
6. Only after the staging deployment succeeds, confirm the tool appeared in the **already-bound Designer** ChatGPT conversation. Have ChatGPT display the exact PR and fixed text first. After the human explicitly approves, call the tool **once**, inspect `ok`, `id`, `url`, `author`, `botAttributed`, and `auditRecorded`. Independently open the returned GitHub comment to verify the exact bot account's name ends with `[bot]` and the comment is not attributed to the operator's human GitHub identity.
7. **Immediately disable** the write pilot with another manual deployment on `main` using `enable_github_app_pilot_comment=false` (keep read-only checked, verified override if required). Confirm `github_post_pilot_comment` disappears while read-only PR retrieval still works. The D1 claim stays as an audit record and no retry mechanism is exposed.

## Failure, retry, rollback and evidence

- `PILOT_WRITE_DISABLED`, `PILOT_TARGET_NOT_ALLOWED`, `PILOT_CONFIRMATION_REQUIRED`, `IDENTITY_NOT_BOUND`, `REPOSITORY_NOT_ALLOWED`: preflight denial; **no GitHub POST**.
- `APP_SECRET_UNAVAILABLE` and other token failures: **no D1 attempt claimed**. Fix authentication before trying again.
- `PILOT_AUDIT_UNAVAILABLE`: D1 migration missing, D1 unavailable or unconfirmed claim; **no POST**. Do not bypass D1 to make a write succeed.
- `PILOT_ALREADY_ATTEMPTED`: another invocation has already claimed this owner/repository/PR. Do not issue a second write or delete the row until the operator manually checks the GitHub PR and reviews the outcome.
- `GITHUB_REQUEST_FAILED`, HTTP error, or malformed JSON **after** D1 claim: GitHub may already have processed the comment. Inspect the PR before deciding whether a recovery is safe; never auto-retry.
- `ok:true` but `botAttributed:false`: the write may have happened, but bot attribution is **not verified**. Investigate the actual GitHub author, do not assert milestone acceptance.
- `ok:true` but `auditRecorded:false`: the GitHub write succeeded but the audit update failed; investigate D1 and retain the one-shot claim; never retry to fix the audit.
- Never print the App PEM, installation token, Cloudflare Access assertion, private owner identifier, bearer header, or the raw GitHub error body in tests, CI or issue comments.
- Record the verified date, App display name, target PR, GitHub comment URL, actual GitHub author and denied-path results in [#5](https://github.com/keego/github-agent-identities/issues/5). The issue remains open until the live write was explicitly approved and bot-attributed.

This deliberately narrow pilot does **not** deliver general comments or two-user write access. Product-wide GitHub operation reuse is separately explored in [#39](https://github.com/keego/github-agent-identities/issues/39).
