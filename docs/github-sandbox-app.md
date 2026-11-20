# GHAI Sandbox Bot — development GitHub App onboarding

> **Status (Nov 20, 2026):** The operator reports **GHAI Sandbox Bot** created and installed on `keego/github-agent-identities` (App ID `5855759`, installation ID `184190090`). The existing Designer App and its successful `keego/poster-brain` PR read remain untouched. **Cloudflare Sandbox key binding and App-backed test are not yet complete.** This is an operator runbook, not a claim of deployment success.

## A. Register the App (GitHub UI)

1. As the repository-owning account, open [New GitHub App](https://github.com/settings/apps/new), or GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Choose a short **globally unique** App name, suggested **GHAI Sandbox Bot** (if unavailable, append a distinguishing suffix); description: `Development and integration testing for GitHub Agent Identities`; Homepage URL: `https://github.com/keego/github-agent-identities`.
3. Leave **Callback URL**, Setup URL and OAuth/user-authorization options unused, because our server uses **installation access tokens**, not GitHub user OAuth. **Disable webhooks** (uncheck Active); no webhook endpoint or webhook secret is needed for polling the API.
4. Initial repository permissions: **Pull requests: Read & write**, with **Contents: No access**, **Issues: No access**, and all other permissions disabled where possible. GitHub automatically provides **Metadata: Read**. `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` accepts an installation token with **either** Pull requests: Write or Issues: Write. Avoid Contents: Write until there is a separately reviewed code-writing milestone.
5. Under installation availability choose **Only on this account**, then click **Create GitHub App**.

Sources: [Register a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app), [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app), [Create an issue comment](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment).

## B. Generate private key and install the App

1. In the new App's **General → Private keys**, click **Generate a private key**. GitHub downloads a PEM. Do not copy this into ChatGPT, GitHub Actions, a PR, D1 or the repo.
2. In **Install App → Install**, choose the `keego` personal account. Select **Only select repositories → `keego/github-agent-identities`**, then finish installation. Do not select all repositories and do not add `keego/poster-brain` to this Sandbox installation.
3. Record **App ID** from the App's General settings and **Installation ID** from the GitHub installation configuration URL (its trailing numeric ID). Both are *non-secret* identifiers; record them privately or share those two numbers for onboarding. The PEM remains a secret.
4. In Cloudflare's existing **github-agent-identities-staging** Worker → **Settings → Variables and Secrets**, add a protected **Secret** called exactly `GH_APP_SANDBOX_PRIVATE_KEY`, pasting the entire original PEM including header/footer and line breaks. Never create an unencrypted plain-text binding or a GitHub Actions PEM secret.
5. Confirm the Worker now lists **two separate secret bindings**: `GH_APP_DESIGN_PRIVATE_KEY` and `GH_APP_SANDBOX_PRIVATE_KEY`. The new verifier accepts both names, checks that each is a protected `secret_text` binding, and refuses unexpected secrets; it never retrieves or prints the secret contents.

Official installation instructions: [Installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app).

## C. Operator-only D1 registry onboarding

No schema change is required: the existing `github_app_identities` table supports multiple Apps per authenticated tenant. In a trusted signed-in conversation, `get_my_tenant_id` returns the opaque verified owner identifier. Use it **privately**, never as a ChatGPT tool-supplied authorization value or in a public issue.

Through the operator-controlled Cloudflare D1 dashboard or authenticated CLI on the **staging** DB only, register a second identity using the *actual* new App/installation IDs:

```sql
INSERT INTO github_app_identities
  (tenant_id, identity_id, display_name, app_id, installation_id, secret_ref, allowed_repos_json)
VALUES
  ('REPLACE_WITH_EXACT_VERIFIED_TENANT_ID',
   'ghai-sandbox',
   'GHAI Sandbox Bot',
   5855759,
   184190090,
   'GH_APP_SANDBOX_PRIVATE_KEY',
   '["keego/github-agent-identities"]');
```

Replace the **entire** quoted tenant-ID placeholder with the exact `get_my_tenant_id` result (which normally already includes the `cloudflare-access:` prefix); do not prepend that prefix twice. The App ID `5855759` and installation ID `184190090` were supplied by the operator. Verify the signed owner tenant ID, the protected Sandbox secret binding, and the target **staging** database before applying SQL. Do **not** alter or overwrite the existing `design` App row. The database stores a *secret binding name*, not a PEM or installation token. Missing IDs or unknown secret: **stop**, do not invent placeholders or attempt a write.

## D. Safe acceptance sequence

1. Keep `GH_APP_COMMENT_PILOT_ENABLED=false`. Deploy staging with `enable_github_app_reads=true`, `enable_github_app_pilot_comment=false`, and existing reviewed Access/Worker binding safeguards. This is a **read-only** check.
2. Start a **separate** ChatGPT test conversation connected to our existing staging MCP plugin. Call `list_identities`, then `bind_identity({identityId:"ghai-sandbox"})` and verify via `get_current_identity`.
3. Read a real PR in `keego/github-agent-identities` via `github_get_pull_request`. This must return `ok:true`, and must not use the human GitHub connector. Also request a `keego/poster-brain` PR as the Sandbox identity; it must return `REPOSITORY_NOT_ALLOWED`.
4. Separately confirm the *original* Designer chat can still read `keego/poster-brain`, and that it cannot read the development repository through that App identity. Do not change the original chat binding.
5. For **the first write** under issue #5, create/select a dedicated harmless test PR in `keego/github-agent-identities` (never use a live feature PR without approval), apply the additive staging D1 migration `0003_pilot_comment_attempts.sql`, and configure the exact owner + test PR privately. Review [the one-shot write runbook](github-comment-pilot.md) before activating the default-off write flag; require explicit human approval of the target and fixed text. One successful bot-authored comment is the acceptance gate; immediately disable writes afterward.

## Distinct identity architecture

| Dimension | Designer (existing) | Sandbox (new) |
| --- | --- | --- |
| Identity ID | `design` | `ghai-sandbox` |
| GitHub App | Poster Brain – UI/UX Designer | GHAI Sandbox Bot |
| Allowed repository | `keego/poster-brain` | `keego/github-agent-identities` |
| Worker secret name | `GH_APP_DESIGN_PRIVATE_KEY` | `GH_APP_SANDBOX_PRIVATE_KEY` |
| Token cache / installation | Existing, independent | New, independent |
| Bound ChatGPT conversation | Current Designer chat | **New separate testing chat** |
| First capability | Verified PR read | PR read, then separately approved one-shot comment |

The objective is to test **multiple Apps under one authenticated user** with separate credentials and repository scopes. It does not complete #16's **two-human** security acceptance; that remains deferred/open until a second actual person is invited.

## GitHub installation-token format compatibility (Nov 2026)

GitHub's [October 2, 2026 changelog](https://github.blog/changelog/2026-10-02-stateless-github-app-installation-tokens-rolled-out/) says new installation tokens now default to `ghs_APPID_JWT` and are approximately 520 characters; the optional format-override header is scheduled for deprecation on **November 30, 2026**. Our token provider treats tokens as opaque strings, caches them without length limits, and forwards the entire string as the Bearer authorization header. We added synthetic tests for **both** legacy opaque and 520+-character stateless formats. Do not inspect token contents, add fixed-length validation, introduce a length-limited database column or force legacy format through the temporary header. Real compatibility remains subject to the separately staged Sandbox App PR read.
