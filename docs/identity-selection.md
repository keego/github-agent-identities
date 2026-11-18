# Conversation identity selection

Each chat can call `identify_chat` to see whether it is registered. Unregistered chats receive a list of available identities with human-readable display names. ChatGPT can use those choices to ask a user to select an identity, then call `bind_identity({ identityId: ... })` and verify the result.

**A graphical dropdown is not yet implemented.** This first implementation uses MCP tools and plain ChatGPT choice prompts; a future MCP Apps interface can render a native selection control once verified in the plugin host. No client is allowed to silently choose an identity.

Production services use `createTenantRouter(store, registry, verifiedTenantId)` so the identities are loaded from the authenticated tenant's configured GitHub Apps. Both the conversation binding and App registry are scoped to that verified tenant.

If a session identifier changes or an App identity is removed, `identify_chat` reports an unbound state and exposes the remaining choices so the conversation can be rebound.

The tool accepts a stable machine-readable identity ID (for example `poster-brain--ui-ux-designer`), while presenting its proper noun display name (for example `UI/UX Designer`). GitHub bot attribution remains determined by the actual registered GitHub App name.
