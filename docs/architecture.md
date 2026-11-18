# Architecture

## Conversation identity and binding

The merged MCP server receives ChatGPT-supplied correlation metadata through SDK v2 `ctx.mcpReq._meta` where available. The client may supply `openai/session` and `openai/subject`. A domain-separated SHA-256 digest of the verified tenant namespace (when established), subject and session becomes the conversation binding key. Raw OpenAI session IDs and subjects are **not** persisted in D1.

The `BindingStore` abstraction currently has an in-memory adapter and a Cloudflare D1 adapter (`src/core.ts` and `src/d1-store.ts`), with SQL schema in `migrations/0001_conversation_bindings.sql`. Identity binding tools return an explicit unregistered/error state when metadata is missing, the selected identity is unavailable, or no binding has been established.

**Security boundary:** OpenAI session/subject fields correlate calls; they are **not authorization credentials**. The tenant principal must be verified by server-side authentication, never by a tool argument, OpenAI metadata, or an OAuth `clientId` (which identifies the OAuth application rather than its user). Missing authenticated principal must fail closed in a deployed service. [#16](https://github.com/keego/github-agent-identities/issues/16) tracks this missing production boundary.

## GitHub identities and installations

An authenticated tenant owns a set of friendly identity names and corresponding GitHub Apps. The `D1AppRegistry` stores App ID, installation ID, secret reference and allowed repositories in `migrations/0002_github_app_identities.sql`. The `InstallationTokenProvider` uses the **server-side private key** to authenticate as the App and obtain a short-lived GitHub installation token. Read/write operations in `src/github-operations.ts` select the current bound identity and explicitly check repository access.

An **App ID** identifies the registered App; an **installation ID** identifies the instance installed on a particular account/organization and its selected repositories. Neither numeric ID is a credential. Pilot IDs (user-confirmed) are App `5808833`, installation `183125278`, label **Poster Brain - UI/UX Designer**. Live installation permission/access verification is outstanding; see [GitHub App setup](github-app-setup.md).

The GitHub App/client operations are implemented and mock-tested, but they are **not connected to a deployed authenticated Worker**. The Worker in `src/worker.ts` remains disabled by default and does not expose GitHub writer tools. A live bot-attributed PR comment is still required to finish [#5](https://github.com/keego/github-agent-identities/issues/5).

## Current modules vs remaining integration

| Implemented in repository | Still required |
| --- | --- |
| MCP SDK server and in-process client/server regression test | Authenticated ChatGPT MCP connection with valid user principal |
| Conversation identity hashing, in-memory bindings, D1 adapter | Worker deployment, D1 migration execution, real persistence testing |
| Tenant-aware App registry, identity listing/binding tool fallback | Operator/tenant-specific registry onboarding and credential provisioning |
| App JWT/installation-token client with expiry-aware caching | Live installation token exchange and permission/expiry failure tests |
| GitHub PR read/comment operations, mocked negative paths | Verified real PR read, then bot-attributed comment |
| Disabled-by-default Worker scaffold | Proper auth middleware, safe deployment guide and staging smoke test |

The production approach is a Cloudflare Worker + D1 instance for a **private, invited set of users**, with a separate self-hosting path for anyone who wants their own deployment. Public Plugin Directory distribution and a dedicated domain remain [future investigations](https://github.com/keego/github-agent-identities/issues/1), not a prerequisite to the pilot.

See the [development roadmap](roadmap.md), [Cloudflare pilot](cloudflare-pilot.md), and [self-hosting guide](self-hosting.md).
