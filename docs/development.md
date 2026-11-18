# Local development and test boundaries

The merged repository contains a **TypeScript MCP server** with chat identity operations, a storage abstraction, D1 and GitHub App adapters, and mock-tested GitHub PR tools. The local server in `src/local.ts` remains an **in-memory identity-only demo**: it does not register GitHub write tools or authenticate arbitrary external users.

**This is not a production-ready public MCP endpoint.** See [roadmap](roadmap.md).

## Requirements

- Node.js 22.16 or later
- npm

```sh
npm install
npm run check
npm run dev:local
```

The local server listens on `127.0.0.1:8787/mcp`. No GitHub credentials or Cloudflare resources are required to run the local identity-only demo.

## Module overview

| Concern | Files | State |
| --- | --- | --- |
| Chat identity and bindings | `src/core.ts`, `src/server.ts`, `src/request-context.ts` | Implemented, protocol-tested |
| In-memory local persistence | `src/core.ts`, `src/local.ts` | Local-only; restarts lose bindings |
| Durable database interface | `src/d1-store.ts`, `migrations/` | Implemented; actual D1 integration pending [#15](https://github.com/keego/github-agent-identities/issues/15) |
| Tenant App registry | `src/github-apps.ts`, `src/tenant-router.ts` | Implemented; authenticated runtime wiring pending |
| Installation-token issuance | `src/github-auth.ts` | Mock-tested; pilot App provisioning pending [#17](https://github.com/keego/github-agent-identities/issues/17) |
| GitHub read/comment tools | `src/github-operations.ts`, `src/github-mcp.ts` | Mock-tested; bot comment acceptance pending [#5](https://github.com/keego/github-agent-identities/issues/5) |
| Cloudflare Worker | `src/worker.ts` | **503-disabled by default**, not a live hosted service |

## Conversation identity metadata

The MCP SDK v2 handler reads incoming conversation correlation metadata from `ctx.mcpReq._meta`, including `openai/session` and `openai/subject` where supplied. Missing or invalid metadata fails closed rather than using one shared "unknown" identity. This information is **not proof of login**.

The verified tenant must be established by trusted OAuth/user-auth middleware. The `verifiedTenantFromContext` helper exists, but no production middleware currently populates its verified principal; implementing that boundary is [#16](https://github.com/keego/github-agent-identities/issues/16). Do **not** treat an OAuth `clientId` as the user ID.

## What CI actually verifies

`npm run check` runs TypeScript checks and Node tests via `tsx`. CI tests include an in-process **real MCP SDK HTTP client/server** request test with synthetic conversation metadata. D1 operations and GitHub App authentication are mocked. All **35** tests passed on merged `main` on November 18, 2026.

These passing checks do **not** establish deployed D1 durability, real ChatGPT OAuth, the GitHub installation-token exchange, bot-attributed comments or Cloudflare production safety. Those have separate issues and acceptance criteria in the [roadmap](roadmap.md).

## Security in development

Keep GitHub App PEM files, JWTs, installation tokens and Cloudflare Worker secret values outside source control, chat messages and logs. Do not enable anonymous GitHub writers. Restrict real App installations to selected repositories and require a validated caller identity for all MCP tools. The public pilot configuration values (App ID `5808833`, installation ID `183125278`) are **identifiers, not secrets**.
