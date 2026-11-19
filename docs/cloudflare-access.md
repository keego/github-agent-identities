# Private MCP authentication with Cloudflare Access

> **Status (November 19, 2026):** The real Worker and Cloudflare Access are deployed to private staging. An authenticated ChatGPT client invoked identity tools; **#16 remains open** for cross-user isolation, reconnect/refresh, revocation and negative-path acceptance. No GitHub write tools are registered.

This project uses **Cloudflare Access Managed OAuth** for the maintainer's private, invite-only hosted instance. Cloudflare handles OAuth sign-in/consent/refresh and restricts access to approved people. The Worker independently validates the signed assertion injected by Cloudflare Access, checks its application audience/issuer, and enforces a second user allowlist.

This avoids hosting a custom OAuth authorization server or buying a new domain. A `workers.dev` hostname is sufficient. Other self-hosters may eventually implement another verified authentication adapter, but **do not bypass JWT verification**.

## Architecture and request trust

1. ChatGPT connects to an Access-protected `https://<worker>.<subdomain>.workers.dev/mcp`.
2. Cloudflare Access Managed OAuth returns OAuth discovery metadata and authenticates the human through an identity provider. Access enforces the configured **allow** policy.
3. The MCP client presents its short-lived OAuth token. **Access** resolves the token and forwards a signed `Cf-Access-Jwt-Assertion` JWT to the Worker.
4. `src/access-auth.ts` independently verifies the JWT's **RS256 signature**, issuing team URL, exact application audience, expiration and user claims. It rejects service-token identities with blank subjects.
5. The Worker checks the subject's verified email against `ALLOWED_ACCESS_EMAILS` (explicit invitation list). All identity tools are registered only **after** this check; absence/misconfiguration returns HTTP 401/403/503 without tools.
6. A tenant key derived from Cloudflare Access's **verified user subject** scopes conversation hashing and selects that tenant's registered GitHub Apps from D1. The OAuth **client ID**, `openai/session`, `openai/subject`, arbitrary tool parameters and caller-set headers do not define account identity.
7. **No GitHub tools are enabled in staging.** A read-only PR tool exists in source behind a disabled operator flag; write tools are unregistered. App reads and bot attribution are still gated separately by #17 and #5.

## Operator setup checklist (not completed automatically)

These settings are specific to each **operator's own** private Cloudflare account. Do not use the maintainer's app, secrets, account or domain when self-hosting.

- [ ] Deploy the **staging Worker** and D1 binding using the staging config in [cloudflare-staging.md](cloudflare-staging.md). Confirm the Worker initially returns 503 for MCP without auth configuration.
- [ ] In Cloudflare Zero Trust → Access controls → Applications, create an **MCP server application** or self-hosted Access application protecting **the entire staging Worker** (not just one path). The Worker-level Access policy protects its `workers.dev` hostname, preview URLs and future custom domains; do not configure an anonymous bypass.
- [ ] Add an explicit allow policy for the operator's own email/account first. Invite trusted friends/family individually later; do not use `Everyone` or a broad public email domain.
- [ ] Enable **Managed OAuth** under the Access application's advanced settings. Set the allowed OAuth client callback URIs using [OpenAI's current MCP plugin authentication guidance](https://developers.openai.com/plugins/build/auth). Ensure dynamic client registration and PKCE/refresh behavior work for the chosen ChatGPT client.
- [ ] Copy the Access application's **AUD tag** (application-specific audience), and the Access **team issuer URL** of the form `https://<team>.cloudflareaccess.com`.
- [ ] Configure these three variables in the **staging Worker deployment environment**, not in the public repository:

| Binding | Format | Why |
| --- | --- | --- |
| `ACCESS_ISSUER` | `https://<team>.cloudflareaccess.com` | Exact signed issuer, and location of Cloudflare's public JWKS endpoint |
| `ACCESS_AUDIENCE` | The Access application's AUD tag | Prevents reusing a token issued for any other Access application |
| `ALLOWED_ACCESS_EMAILS` | Comma-separated invited emails | Second, server-side invitation gate; missing/empty means HTTP 503 |

- [ ] Set `MCP_PUBLIC_HOSTNAME` to the **exact** Worker hostname. Do not hardcode personal domains in the repo.
- [ ] Verify unauthenticated requests never invoke MCP, a signed token from another audience is rejected, and an uninvited account gets 403.
- [ ] Connect ChatGPT through the OAuth flow and verify two authorized users have **different** identity lists and per-chat binding namespaces; test token expiry/revocation and reconnection.

The public repository's `cloudflare.config.ts` defaults all three auth values to empty strings. As a result, **deployment without explicit configuration refuses MCP**. Never commit real user-email allowlists or secrets to source.

## Testing locally before provisioning an Access application

```sh
npm install
npm run check
npm run cf:build
```

The tests generate short-lived synthetic RSA signing keys entirely in memory and use local JWK verification to simulate signed Cloudflare Access assertions. They cover wrong issuer/audience, expired/forged tokens, missing signatures, service tokens, uninvited emails, absent settings, and a real SDK HTTP MCP client test with **two separately authorized users sharing identical conversation metadata**. It also verifies the Worker exposes no GitHub write tools.

Synthetic tests alone do not prove a real Cloudflare login. A single-user authenticated ChatGPT tool-call smoke test was observed November 19, but cross-user isolation, reconnect/refresh, token revocation and live negative paths still require verification under #16.

## Authentication failure handling

| Status | Meaning | Typical response |
| --- | --- | --- |
| 503 | Missing Access issuer, audience or email allowlist; unavailable D1 | Check operator bindings and staging migrations |
| 401 | Missing, malformed, expired, forged, wrong-issuer or wrong-audience assertion | Authenticate/reconnect via Access Managed OAuth; check app AUD |
| 403 | Valid Access assertion for a user **not invited to the Worker** | Update the operator's Access policy and the Worker allowlist if appropriate |
| 404 | A path other than `/mcp` or the public `/health` probe | Check the custom MCP endpoint path |

Access normally intercepts unauthenticated HTTP requests itself and sends the OAuth discovery challenge. Our Worker returns a sanitized 401 if it is reached without a verified signed assertion, as defense-in-depth.

## Security and operator responsibilities

- Treat `Cf-Access-Jwt-Assertion` as a **bearer credential**. Never log it or leak it in tool results, CI artifacts or PR comments.
- Public `workers.dev` network availability is **not** public authorization. Access must protect every route, preview and associated domain; the Worker's JWT verification is an additional guard.
- On revoking a user's access, remove them from the Access policy **and** the Worker allowlist. Previously issued JWTs may remain valid until expiration; use short access-token lifetimes (Cloudflare recommends 5–15 minutes for agents).
- Do not allow service tokens to act as human tenants; this phase requires nonempty signed human subject + email.
- No GitHub App private key is involved in this PR. When added in #17, it belongs **only** in protected Cloudflare secrets.
- Cloudflare Access's identity principal is distinct from the GitHub App bot identity. Cloudflare establishes *which person can use the router*; the binding determines *which GitHub App acts on their behalf*.

## Deferred setup and dependencies

The private deployment epic is [#6](https://github.com/keego/github-agent-identities/issues/6). A first authenticated ChatGPT tool-call smoke test was observed November 19; [#16](https://github.com/keego/github-agent-identities/issues/16) remains open until live cross-user, reconnect/refresh, revocation and denial tests pass. [#17](https://github.com/keego/github-agent-identities/issues/17) covers the App read-only pilot; [#5](https://github.com/keego/github-agent-identities/issues/5) separately gates bot-authored comments.

References: [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/), [Protect Cloudflare Workers with Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [Cloudflare Access JWT claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/), [OpenAI Plugin authentication](https://developers.openai.com/plugins/build/auth).
