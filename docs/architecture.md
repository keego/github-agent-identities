# Architecture

## Identity binding

The MCP server receives `_meta["openai/session"]` and `_meta["openai/subject"]` on tool calls when ChatGPT supplies them. A domain-separated SHA-256 digest of both identifiers is the conversation binding key. Raw session IDs and raw subjects are **not** persisted to D1.

The service lists friendly identity definitions (ID and display name) and lets a conversation explicitly bind to one. A missing session, subject or stored binding results in a clear unregistered/error response rather than choosing a role.

The `BindingStore` interface supports in-memory testing and Cloudflare D1. `migrations/0001_conversation_bindings.sql` is the initial D1 schema.

**Security boundary:** The OpenAI metadata is for correlation, not trustworthy user authentication. Before deploying GitHub write tools to an Internet-facing endpoint, add an authenticated per-user/tenant principal and enforce App/repository permissions with that principal. A missing authenticated principal must fail closed. This is tracked as deployment work in #6.

## Future modules

- Registry: persistent GitHub App ID, installation ID, display name, repo allowlist, authorized tenant.
- Credentials: protected key storage and short-lived installation tokens, never sent to model-visible tool results.
- GitHub API: small read/write tool set that resolves the bound App and enforces repository authorization.
- Transport: MCP SDK v2 behind a Cloudflare Worker with authenticated access, or a self-hosted Node server.

See [self-hosting](self-hosting.md) for planned deployment and publishing constraints.
