# GitHub Agent Identities

![GitHub Agent Identities — Open-source ChatGPT / Codex plugin. One plugin. Multiple conversations. Distinct GitHub identities. Feature overview: chat recognition, identity picker, scoped access, bot attribution.](assets/feature-overview.svg)

**One plugin. Multiple conversations. Distinct GitHub identities.**

Give separate ChatGPT or Codex conversations recognizable GitHub App identities when they collaborate on issues and pull requests—without standing up a separate plugin or MCP server for each agent.

> **Project status: early prototype / design.** A separate proof of concept successfully identified distinct ChatGPT conversations and retained independent role bindings across repeated calls. The production MCP server and GitHub App integrations are **not yet implemented in this repository**.

## How it will work

1. Deploy or connect to one MCP router that exposes identity and GitHub operations.
2. Configure your own GitHub Apps and restrict their installations to chosen repositories.
3. In each conversation, choose an available App identity (for example, Designer, QA, or Developer).
4. The router recognizes the calling conversation and selects its bound App for subsequent GitHub tool requests.
5. GitHub attributes API comments, reviews and PR actions to the corresponding App bot—not to the human who configured it.

A missing or unrecognized conversation binding will prompt you to choose an identity again. We intend to support a picker UI where the ChatGPT plugin interface permits it, with a simple role-selection fallback.

## Deployment and access

| Mode | Audience | Intended behavior |
| --- | --- | --- |
| **Self-hosted** | Anyone | Deploy your own MCP endpoint, bring your own GitHub Apps, and connect it to ChatGPT as a custom MCP server. No dependency on the maintainer's service. |
| **Private hosted instance** | Maintainer and invited friends/family | Same open-source server, but authenticated and access-restricted. **Not** a public free service. |
| **Public ChatGPT plugin** | Potential future release | A discoverable directory listing, subject to OpenAI's endpoint rules and publication review. |

**Self-hosting is a first-class goal**, not an afterthought. See [Self-hosting and deployment architecture](docs/self-hosting.md) for the planned components, credentials model, and setup path. The guide is currently architectural; runnable deployment instructions will come with the server implementation.

### Public plugin publication: still on the roadmap

OpenAI's standard public MCP plugin submission currently requires a **stable, publicly accessible HTTPS endpoint**. Template endpoints that vary by customer are presently limited to trusted developers with an established relationship. This means we **cannot promise** that a publicly listed plugin will let every user type in an arbitrary self-hosted MCP URL. However, users can connect their own servers as **custom MCP connections** where their plan/workspace permits.

We'll revisit a dedicated project domain (rather than using the maintainer's personal domain), endpoint templates, reviewer requirements and a sustainable hosted/public distribution model later. Publishing is a goal—not a blocker for building and self-hosting now.

References: [OpenAI plugin submission](https://developers.openai.com/plugins/deploy/submission) · [MCP endpoint templates](https://developers.openai.com/plugins/deploy/app-review) · [Connecting custom MCP servers](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

## Roadmap

- [x] Validate that different ChatGPT conversations can obtain distinct session fingerprints and retain different role bindings in a proof of concept.
- [ ] Publish a reusable TypeScript MCP server and automated tests.
- [ ] Persist user-scoped conversation-to-App identity bindings.
- [ ] Add a supported identity selection experience and recovery for unbound chats.
- [ ] Connect GitHub Apps using securely stored credentials and short-lived installation tokens.
- [ ] Read GitHub PRs and issues; write a test PR comment attributed to the selected bot.
- [ ] Ship tested, documented self-hosting (initially considering Cloudflare Workers + D1).
- [ ] Decide on a dedicated domain, public plugin eligibility and submission strategy.

## Security principles

- GitHub App credentials stay in the operator's protected server-side secret store—never in chats or the open-source repository.
- Server authorization determines which GitHub Apps a user may bind; conversation metadata by itself is not a security credential.
- GitHub App installations should be limited to selected repositories, with only needed permissions.
- Public reachability of an HTTPS endpoint must **not** imply anonymous permission to perform GitHub writes.

## License

MIT. See [LICENSE](LICENSE).
