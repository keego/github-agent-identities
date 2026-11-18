# Local-first QA and GitHub Actions efficiency

> Our default is **test locally, then let CI confirm the final candidate**. Actions is a safety net—not a substitute for running tests after every source edit. Related: [#23](https://github.com/keego/github-agent-identities/issues/23) and [lockfile follow-up #24](https://github.com/keego/github-agent-identities/issues/24).

## Before the first push

Use Node.js 22.16 or newer, on an actual local checkout (including ChatGPT Work's execution environment when available):

```sh
npm install --no-audit --no-fund
npm run qa:local
```

The `qa:local` command runs TypeScript checking, **all** tests (including the local Miniflare/D1 integration suite), and a Cloudflare staging Worker **bundle only**. No Cloudflare account, GitHub private key, public Worker or live GitHub token is required. Running the build is **not** deployment.

For focused iterations, use `npm run typecheck`, `npm test` or `npm run test:d1` locally; run the full `qa:local` preflight before marking a PR ready for review. Do not skip the full local preflight for a security-sensitive change unless clearly marked as a limitation.

**Reproducibility caveat:** this repository currently lacks a committed `package-lock.json`. Use `npm install` until [#24](https://github.com/keego/github-agent-identities/issues/24) adds a reviewed lockfile and changes both local setup and CI to `npm ci`. Do not synthesize lockfile hashes, or enable an unverified dependency cache.

## Pull request lifecycle

1. Make changes in a **local working tree** where possible, and run focused checks before pushing.
2. Collect related fixes into one logical change. **Batch file updates** into one commit/push instead of one GitHub API commit per edited file. Agents using GitHub's Git Data API should build a single tree and commit for a coherent change.
3. Open a **draft PR** during active work. Its CI job is intentionally skipped; additional draft commits don't spin up runners.
4. Finish source review, validate error paths (especially authorization, tenant isolation, secret handling and repository scope), and run `npm run qa:local`. Paste the results (or a clear execution limitation) into the PR.
5. Mark the PR **Ready for review**. GitHub runs the full CI check. If a fix is needed, reproduce it locally first and batch fixes before pushing.
6. A new commit on a ready PR cancels the superseded in-progress CI run; only the latest candidate matters. Keep the PR in draft if substantial revisions are expected.
7. Preserve the **post-merge `main` CI** as the integrated regression gate. Don't claim a deployed Worker, real OAuth login, or genuine GitHub App attribution merely because local or CI tests pass.

If the current agent environment cannot access a working tree/npm dependencies, **state that explicitly** rather than claiming local tests were run. Do a static source/test review and batch changes where possible; request an independent local execution pass for unverified code. Do not use a succession of GitHub Actions failures as a live debugger.

## Actions scheduling and what it costs

The `.github/workflows/ci.yml` job now:

- **Skips runner execution for drafts**, starts when a PR becomes ready, and also runs on later ready-PR updates.
- Cancels outdated runs **for the same PR** while preserving the full check for merged `main`.
- Uses one job with a 10-minute timeout and read-only repository permissions; avoids leaving a credential in the checkout.
- Runs the **same full preflight** as a developer does locally; never swallows failing exit codes.
- Supports manual `workflow_dispatch` for unusual recovery cases.

GitHub currently makes **standard GitHub-hosted runners in public repositories free**. This repo is public, so frequent runs here are not by themselves evidence that the account's paid Actions compute allowance is being depleted; check the billing breakdown for private repositories, larger runners, cache/artifact storage and other services. Even when runs are free, unnecessary CI activity creates review noise, eats queue capacity and slows iteration.

A committed lockfile and npm cache (tracked by [#24](https://github.com/keego/github-agent-identities/issues/24)) can reduce setup time further, but those changes should be tested in a separate PR.

References: [GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage), [Workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), [Dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

## What still needs real-world testing

An end-to-end private MCP release requires the actual Cloudflare Access application/Managed OAuth flow, invited-user policy, D1 registry onboarding, secure App PEM binding, and a **read-only** GitHub API request. Those acceptance tests are tracked by [#16](https://github.com/keego/github-agent-identities/issues/16) and [#17](https://github.com/keego/github-agent-identities/issues/17). Bot-attributed writes are separately gated by [#5](https://github.com/keego/github-agent-identities/issues/5).
