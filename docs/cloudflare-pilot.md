# Cloudflare pilot — deployment is gated

The repository includes a Cloudflare Workers module in `src/worker.ts`, but **does not deploy anything automatically**. The module is **disabled by default**. It returns HTTP 503 for MCP requests until a separate authenticated access layer is implemented, or an operator explicitly enables a credential-free identity-only test mode.

## Environment bindings

- `DB`: Cloudflare D1 binding with migrations 0001 and 0002.
- `MCP_PUBLIC_HOSTNAME`: exact HTTPS hostname expected for Host validation, excluding scheme.
- `ENABLE_UNAUTHENTICATED_DEMO`: optional string `true`; allows only identity POC tools, **not GitHub tools**.

The demo mode is only for a short-lived, controlled integration test and must not store secrets, expose GitHub App write operations, or be offered as a shared public service.

## Authentication required before a real deployment

1. Implement ChatGPT-compatible OAuth authorization for the MCP endpoint.
2. Validate token claims at the Worker boundary and derive a verified tenant ID there.
3. Pass verified authentication to the MCP handler; do not treat `_meta["openai/subject"]` as the login identity.
4. Construct the authenticated tenant's identity catalog from the D1 App registry.
5. Register GitHub read/write tools only when authentication, per-tenant App ownership, repository allowlists and secrets are all configured.
6. Test token expiry, revocation, user isolation, GitHub App attribution and error logging.

No GitHub App private keys, installation tokens, or other credentials are included in this repository. Key provisioning should use Cloudflare Workers secrets and an operator-only setup flow.

See [Cloudflare's stateless MCP handler docs](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/) and [OpenAI MCP plugin auth](https://developers.openai.com/plugins/build/auth).

## Next operator configuration

The pilot GitHub App ID is 5808833. The App **installation ID** and **private key** are still required to exercise GitHub API tools. Do not paste the private key into issues or ChatGPT messages; it should be provisioned directly in Cloudflare's secrets interface.

The operator will also need to choose the authentication method for an invited-only deployment and verify that ChatGPT can connect before we enable any writes.
