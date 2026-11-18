import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationMetadata } from "../src/request-context.ts";
import { IdentityRouter, MemoryBindingStore, exampleIdentities } from "../src/core.ts";

test("MCP SDK v2 ctx.mcpReq._meta yields conversation data", async () => {
  const ctx = { mcpReq: { _meta: {
    "openai/session": "real-session-fingerprint-placeholder",
    "openai/subject": "account-subject",
  } } };
  const router = new IdentityRouter(new MemoryBindingStore(), exampleIdentities);
  const meta = conversationMetadata(ctx);
  assert.equal((await router.identify(meta)).registered, false);
  await router.bind(meta, "design");
  assert.equal((await router.identify(conversationMetadata(ctx))).identity?.id, "design");
});

test("rejects legacy flattened metadata and missing MCP context", () => {
  assert.equal(conversationMetadata({ _meta: { "openai/session": "s" } }), undefined);
  assert.equal(conversationMetadata({ mcpReq: null }), undefined);
  assert.equal(conversationMetadata({ mcpReq: { _meta: [] } }), undefined);
  assert.equal(conversationMetadata(undefined), undefined);
});
