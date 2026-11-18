# Private Cloudflare MCP pilot

> **Status:** The repository includes local D1 integration tests, Cloudflare Worker bundling, and an **Access-authenticated** MCP identity endpoint. The code is tested with signed synthetic assertions, but **no real Access application or ChatGPT OAuth connection has been verified**. A staging D1 database exists; GitHub App credentials and live bot writes are not deployed.

## Components and configuration

- `DB`: Cloudflare D1 database with conversation binding and tenant App registry schema.
- `MCP_PUBLIC_HOSTNAME`: Exact public Worker hostname for Host validation, without scheme.
- `ACCESS_ISSUER`: Verified Cloudflare Access team issuer, `https://<team>.cloudflareaccess.com`.
- `ACCESS_AUDIENCE`: Access application's unique audience tag.
- `ALLOWED_ACCESS_EMAILS`: Explicit invited-user allowlist; empty means the Worker refuses MCP access.
- `ENABLE_UNAUTHENTICATED_DEMO`: Old proof-of-concept switch. **No longer honored** by the authenticated Worker; it cannot bypass sign-in.

Cloudflare Access **Managed OAuth** supplies user sign-in, OAuth discovery, consent and token refresh. The Worker independently validates the signed `Cf-Access-Jwt-Assertion` via Cloudflare public keys, checks issuer/audience/time and allowlist, and derives the tenant namespace exclusively from the signed human subject. The Worker constructs an MCP router for that verified tenant **after** authentication. A request's OAuth `clientId` or MCP `openai/subject` metadata never authorizes a person.

Until an operator configures Access, issuer, audience and allowlist, the MCP endpoint returns HTTP **503**. A signed assertion from an uninvited user is denied **403**. There is **no anonymous identity-only mode** and no GitHub API tools in the Worker.

## Next operator steps

1. Read [Cloudflare Access setup](cloudflare-access.md) for an invited-only staging Access application, Managed OAuth and verification.
2. Make sure the existing staging D1 database is bound correctly, and deploy the Worker with an exact staging hostname.
3. Configure the Access team issuer, application AUD and invited-user allowlist through the operator deployment environment; don't commit addresses or credentials.
4. Test a real ChatGPT custom MCP connection with at least one invited account, including reconnect/refresh and missing/invalid-token denial. Close [#16](https://github.com/keego/github-agent-identities/issues/16) only after that live verification.
5. Provision GitHub App 5808833 / installation 183125278 **via protected Worker secrets** and verify a read-only API operation under [#17](https://github.com/keego/github-agent-identities/issues/17), then explicitly approve a test bot comment under [#5](https://github.com/keego/github-agent-identities/issues/5).

No custom domain purchase or public free-service hosting is required.

See [local D1/staging development](cloudflare-staging.md), [private authentication](cloudflare-access.md), and the [implementation roadmap](roadmap.md).
