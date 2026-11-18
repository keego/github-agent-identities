# Development (initial MCP foundation)

This repository contains a **local-only** MCP identity service at this stage. It has no GitHub write capability and is not yet suitable for anonymous public hosting.

## Requirements

- Node.js 22.16 or later
- npm

```sh
npm install
npm run check
npm run dev:local
```

The server binds to `127.0.0.1:8787` and uses MCP Streamable HTTP at `/mcp`. No credentials are necessary for this local synthetic test.

The identity registry is temporary in-memory storage. The planned D1 adapter will replace it in the next milestone.

## Metadata

Calling clients should provide `_meta["openai/session"]` and `_meta["openai/subject"]` to tool handlers. If either is missing, the service refuses to bind or resolve the conversation rather than sharing an "unknown" identity.

This metadata is **not an authorization credential**. Do not expose GitHub write tools until proper user authentication, tenant isolation and an allowlist are implemented.

## Tests

`npm run check` runs TypeScript checking and Node's built-in test runner. Tests use synthetic anonymized metadata; they do not claim live ChatGPT or GitHub integration.
