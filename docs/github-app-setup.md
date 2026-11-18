# GitHub App configuration (planned)

> This is a development reference, **not** a working onboarding flow. A GitHub App was created for the initial pilot, but its credentials are not included in this public repository.

## Pilot metadata

- Human label: **Poster Brain - UI/UX Designer**
- GitHub App ID: `5808833` (public identifier, **not** a token)
- Initial repository: `keego/poster-brain`
- Installation ID: **not yet provisioned to the service**
- Private key: **not yet provisioned to the service**

The server maps authenticated tenants and friendly identity IDs to numeric App IDs plus installation IDs. Do not derive any credentials from display names.

## Configuration

The first implementation stores these fields in a D1 registry (migration 0002):
`tenant_id`, `identity_id`, `display_name`, `app_id`, `installation_id`, `secret_ref`, `allowed_repos_json`.

For example, a server-side secret binding might be named `GH_APP_DESIGN_PRIVATE_KEY`. The **value** is the PEM private key and must be stored only in the deployment platform's protected secrets facility. Do not store PEM material in D1, code, GitHub issues, or ChatGPT messages.

GitHub App authentication uses short-lived installation access tokens. The Octokit authentication package handles GitHub's private-key format and JWT/token exchange; requests must never return raw credentials to the model.

## Operator steps still required

1. Obtain the numeric **installation ID** for App 5808833 installed on the desired repository.
2. Generate the App's private key in GitHub and securely provision it to Cloudflare Worker secrets (or your self-host host), **without sharing it in a ChatGPT conversation**.
3. Establish authenticated MCP access and an account-to-tenant mapping before exposing GitHub tools publicly.
4. Test a read-only GitHub operation, then an explicitly approved PR comment; verify bot attribution.

References: [GitHub App authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app) and [installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).
