# GitHub App configuration

> **Status: pilot identifiers confirmed; live credentials not yet provisioned.** The repository contains a GitHub App installation-token client and tenant-scoped identity registry, but the private Worker is not deployed and bot-attributed writes have not been verified. Do not mistake this document for an executable deployment guide.

## What the IDs mean

A GitHub App has one numeric **App ID**. Each time that App is installed on a GitHub user or organization account, GitHub creates a separate **installation** with its own numeric **installation ID**. An installation authorizes the App for specific repositories (or all repositories in the account) and the App's approved permissions. Many ChatGPT conversations can use **one installation** while selecting different GitHub App identities through the router.

| Identifier or credential | Pilot value | Purpose | Secret? |
| --- | --- | --- | --- |
| GitHub App ID | `5808833` | Identifies the registered **Poster Brain - UI/UX Designer** App to GitHub's App authentication flow | No |
| GitHub installation ID | `183125278` | Selects this particular App installation when requesting a GitHub installation access token | No |
| GitHub App private key | Provisioned directly to the secret manager later | Signs a short-lived **App JWT**, proving the server controls the registered App | **Yes** |
| Installation access token | Generated dynamically; do **not** store in the registry | Short-lived bearer token that allows GitHub API operations as that App installation | **Yes** |
| Router identity ID / friendly display name | e.g. `poster-brain--ui-ux-designer` / **UI/UX Designer** | Selects the configured GitHub App for a particular authenticated ChatGPT conversation | No |

**How the flow works:** the server loads the current chat's bound identity → looks up App ID `5808833`, installation ID `183125278` and the allowed repositories → signs an App JWT using the private key stored **server-side** → exchanges it for a short-lived token for **installation `183125278`** → calls the GitHub API using that token. GitHub attributes authorized writes to the App bot. The app and installation IDs alone **cannot** authenticate or grant access.

The installation ID is **not** the ChatGPT conversation ID, a repository ID, a GitHub user ID, or a token. It generally remains associated with that installation, but uninstalling/reinstalling the App may create a **new** installation ID; recheck configuration when changing accounts or reinstalling.

## Pilot configuration

- Registered App: **Poster Brain - UI/UX Designer**
- App ID: `5808833` (operator-confirmed)
- Installation ID: `183125278` (operator-confirmed, **not yet verified by a live API call**)
- Target repository: `keego/poster-brain` (**verify it is actually included in the App installation before enabling access**)
- Human-facing router label: **UI/UX Designer**
- Private-key secret binding name: `GH_APP_DESIGN_PRIVATE_KEY` (example name only)
- Private key: **not yet provisioned to the service**
- First GitHub write: **not yet performed or verified**

These public IDs are pilot examples; self-hosting operators must provide their **own** App ID, installation ID, keys and repository allowlists. Do not bake these identifiers into generic deployment defaults.

## Registry schema

The merged `migrations/0002_github_app_identities.sql` stores:

`tenant_id`, `identity_id`, `display_name`, `app_id`, `installation_id`, `secret_ref`, `allowed_repos_json`.

`secret_ref` names a protected secret binding; **never** store the PEM key or an installation access token in D1, Git, issues, logs, or ChatGPT messages. The server must derive `tenant_id` from a verified user principal, not from the OAuth **client ID** or from model-supplied MCP metadata.

The server's `InstallationTokenProvider` uses Octokit App authentication, caches installation tokens with expiry awareness, and avoids exposing the token in MCP tool results. It has only been validated with synthetic/mock authentication; a real read-only API call is still required.

## Operator steps (not yet executable end-to-end)

1. Deploy the private Worker and test D1 migrations in staging ([#15](https://github.com/keego/github-agent-identities/issues/15)).
2. Implement ChatGPT-compatible OAuth and verified per-user tenant isolation; protect all MCP tools ([#16](https://github.com/keego/github-agent-identities/issues/16)).
3. Verify App `5808833` / installation `183125278` relationship and that the installation can access the intended repository. Check installation permissions and selected repository access.
4. Create a GitHub App private key in GitHub's App settings and **provision it directly into Cloudflare Workers secrets**, without pasting it into ChatGPT or committing it.
5. Register the App/installation and its permitted repositories for the verified tenant, then perform a read-only request with a short-lived installation token ([#17](https://github.com/keego/github-agent-identities/issues/17)).
6. In an authenticated ChatGPT conversation, bind the UI/UX Designer identity, then post one explicitly approved test PR comment and verify that GitHub's author ends in `[bot]` rather than the human account ([#5](https://github.com/keego/github-agent-identities/issues/5)).

No custom domain is required for the private pilot. Public directory distribution is separately tracked in [#1](https://github.com/keego/github-agent-identities/issues/1).

GitHub documentation: [About authentication with a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app) · [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).
