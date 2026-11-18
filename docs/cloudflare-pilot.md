# Private Cloudflare MCP pilot

> **Status:** The **real** MCP Worker was deployed to Cloudflare staging on November 18, 2026 ([successful run](https://github.com/keego/github-agent-identities/actions/runs/44378420871)). Its staging D1 binding and owner-only Cloudflare Access Managed OAuth application are configured. Tests use synthetic signed assertions; **a real ChatGPT OAuth sign-in has not yet been verified**. The D1 App registry remains empty, and there is no GitHub App PEM or live bot write.

## Components and configuration

- `DB`: Cloudflare D1 database with conversation binding and tenant App registry schema.
- `MCP_PUBLIC_HOSTNAME`: Exact public Worker hostname for Host validation, without scheme.
- `ACCESS_ISSUER`: Verified Cloudflare Access team issuer, `https://<team>.cloudflareaccess.com`.
- `ACCESS_AUDIENCE`: Access application's unique audience tag.
- `ALLOWED_ACCESS_EMAILS`: Explicit invited-user allowlist; empty means the Worker refuses MCP access.
- `ENABLE_UNAUTHENTICATED_DEMO`: Old proof-of-concept switch. **No longer honored** by the authenticated Worker; it cannot bypass sign-in.

Cloudflare Access **Managed OAuth** supplies user sign-in, OAuth discovery, consent and token refresh. The Worker independently validates the signed `Cf-Access-Jwt-Assertion` via Cloudflare public keys, checks issuer/audience/time and allowlist, and derives the tenant namespace exclusively from the signed human subject. The Worker constructs an MCP router for that verified tenant **after** authentication. A request's OAuth `clientId` or MCP `openai/subject` metadata never authorizes a person.

Until an operator configures Access, issuer, audience and allowlist, the MCP endpoint returns HTTP **503**. A signed assertion from an uninvited user is denied **403**. There is **no anonymous identity-only mode**. Read-only GitHub tools exist in source but are explicitly disabled in the deployed staging configuration; no comment/write MCP tools are registered.

## Next operator steps

1. The staging Worker and owner-only Access application are already provisioned. Read the [live staging runbook](live-staging-deployment.md) for the latest evidence and setup details. The one-time API bootstrap takeover is complete; do **not** select takeover mode on future deploys.
2. Test a real ChatGPT custom MCP connection with the invited account, including consent, reconnect/refresh and missing/invalid-token denial. After sign-in, call `get_my_tenant_id`, `list_identities`, and `identify_chat`.
3. Keep `GH_APP_READONLY_ENABLED=false` until this test passes; zero D1 identities is expected at this stage. Close [#16](https://github.com/keego/github-agent-identities/issues/16) only after that live verification.
5. Provision GitHub App 5808833 / installation 183125278 **via protected Worker secrets** and verify a read-only API operation under [#17](https://github.com/keego/github-agent-identities/issues/17), then explicitly approve a test bot comment under [#5](https://github.com/keego/github-agent-identities/issues/5).

No custom domain purchase or public free-service hosting is required.

See [local D1/staging development](cloudflare-staging.md), [private authentication](cloudflare-access.md), and the [implementation roadmap](roadmap.md).
