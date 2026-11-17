# Self-hosting GitHub Agent Identities

> **Status: design guide.** This repository currently contains project documentation and the feature overview, not a production-ready deployable MCP server. These steps describe the intended architecture and will become an executable installation guide as implementation lands.

The project is intended to be **self-hostable by default**. You should not need an account on the maintainers' private service, and you should not have to share GitHub App private keys with the maintainers.

## Intended components

| Component | Responsibility |
| --- | --- |
| Your HTTPS MCP server | Exposes chat identification, identity binding, and GitHub tools |
| Persistent data store | Stores user-scoped conversation-to-identity bindings, App installation metadata and audit records |
| GitHub Apps | Give different agent identities independently attributed actions and repository-scoped access |
| Protected secret store | Holds GitHub App private keys / signing credentials, never in Git or chat messages |
| User authentication | Identifies permitted users of *your* server; authorizes identity changes and tool calls |

A Cloudflare Worker and D1 are the first planned deployment target. Other hosts should be possible as long as they support MCP Streamable HTTP, durable storage, and secure secret handling. The implementation should not depend on Cloudflare-specific interfaces outside an adapter.

## Intended setup flow (not yet executable)

1. Deploy your own MCP service on a stable HTTPS endpoint, typically ending in `/mcp`.
2. Configure persistent storage and secure secrets for that installation.
3. Require authentication; do not expose anonymous GitHub write tools.
4. Register one or more [GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app), grant only the permissions needed, and install each on **selected repositories**.
5. Store each App's credentials in the server's protected secret store, not in ChatGPT messages, source control, or browser-facing config.
6. In ChatGPT, add a **custom MCP server connection** using your own HTTPS endpoint (or a supported private-tunnel option). This is separate from installing a public-directory plugin.
7. In a conversation, use the identity-binding tool to select an App. Subsequent GitHub calls from that conversation should resolve its binding server-side.
8. Confirm bot attribution on a harmless test issue or PR before enabling broader write operations.

**None of these steps should be presented as a working one-click installer until the implementation and onboarding flow exist.**

## Conversation identity and storage

The validated proof of concept used MCP request metadata to correlate calls from separate ChatGPT conversations. The implementation plan is to derive a pseudonymous binding key from the calling user's authenticated identity and the session identifier (such as `_meta["openai/session"]` where provided), instead of asking the model to attach its role to every GitHub request.

If a session binding is missing or changes, show the available identities and let the user rebind. Never silently select an identity. A session identifier is a correlation value, **not proof of authorization**; the server must still authenticate users and enforce access to their stored Apps.

## Keeping an instance private

You may run the service only for yourself or trusted people. A public HTTPS **network address** is not the same as a publicly usable **service**:

- Gate requests with OAuth or equivalent user authentication, and allowlist the permitted users.
- Allow each user to access only the App installations and chat bindings they own or are explicitly allowed to use.
- Keep App private keys server-side and issue short-lived GitHub installation tokens.
- Protect against cross-account binding lookup, log leakage, and arbitrary App selection.
- Provide a credential-rotation and installation-revocation path.

For a truly private MCP server, investigate [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) where supported. It is useful for private connections but **is not a public Plugin Directory submission endpoint**.

## Plugin distribution is separate from hosting

We aim to support two paths:

1. **Open-source self-hosting:** Fork/deploy the MCP service and connect your own URL as a custom MCP server in ChatGPT. No traffic should go to the maintainers' service.
2. **Potential public Plugin Directory listing:** This remains a roadmap item, not a promised feature. OpenAI currently expects a stable public HTTPS MCP endpoint for standard remote plugin submissions. Per-customer **template MCP URLs** are restricted to trusted developers with an established relationship, so a generic public listing with a URL field for every self-hosting user cannot be assumed to work.

A future public listing may require a shared hosted endpoint with its own supported user authentication and access policy, a special approved endpoint-template arrangement, or another documented distribution channel. **The maintainers' personal instance is not a public free hosting service.**

Sources: [OpenAI custom MCP server setup](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt), [Plugin submission](https://developers.openai.com/plugins/deploy/submission), [Remote MCP review and URL templates](https://developers.openai.com/plugins/deploy/app-review), [GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps).

## Implementation checklist

- [ ] Publish the MCP server, persistent-storage schema/migrations, and automated tests.
- [ ] Build installation onboarding and GitHub App credential management.
- [ ] Implement per-user authentication, tenant isolation, role discovery and binding.
- [ ] Implement GitHub read/write operations and verify bot attribution.
- [ ] Document executable self-host deployment, upgrades, backups, and credential rotation.
- [ ] Explore domain acquisition, public submission review requirements, and endpoint-template eligibility.
