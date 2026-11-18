# Cloudflare pilot — deployment is gated

The merged repository includes a Cloudflare Workers module in `src/worker.ts`, D1 store adapter and migration files, and mock/unit protocol tests. **No production Worker or D1 instance has been deployed or verified yet.** The module is **disabled by default**: it returns HTTP 503 for MCP requests until an authenticated access layer is implemented or an operator explicitly enables the credential-free, identity-only demo mode.

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

The pilot uses GitHub **App ID `5808833`** and operator-confirmed **installation ID `183125278`** for **Poster Brain - UI/UX Designer**. Both numeric IDs are public identifiers, **not credentials**. The installation's repository selection and actual token issuance have **not** been verified by a live API call. A GitHub App **private key is still required** to exercise real GitHub API tools; provision it directly in Cloudflare's protected Worker secrets, never in an issue, chat, D1 field or commit. See [GitHub App setup](github-app-setup.md).

The operator will also need to configure authenticated, invited-only access and verify that ChatGPT can connect before any GitHub write tools are enabled. See the [deployment roadmap](roadmap.md) and issues [#15](https://github.com/keego/github-agent-identities/issues/15), [#16](https://github.com/keego/github-agent-identities/issues/16), and [#17](https://github.com/keego/github-agent-identities/issues/17). No dedicated domain or public free hosting is required for the pilot.
