import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IdentityError,
  IdentityRouter,
  MemoryBindingStore,
  exampleIdentities,
  getChatIdentity,
} from "../src/core.ts";

const meta = (subject: string, session: string) => ({
  "openai/subject": subject,
  "openai/session": session,
});

test("two conversations get different fingerprints and independent bindings", async () => {
  const router = new IdentityRouter(new MemoryBindingStore(), exampleIdentities);
  const a = meta("user-1", "chat-A");
  const b = meta("user-1", "chat-B");
  assert.equal((await router.identify(a)).registered, false);
  assert.equal((await router.identify(b)).registered, false);
  await router.bind(a, "design");
  await router.bind(b, "qa");
  assert.equal((await router.identify(a)).identity?.id, "design");
  assert.equal((await router.identify(b)).identity?.id, "qa");
  assert.notEqual((await router.identify(a)).fingerprint, (await router.identify(b)).fingerprint);
});

test("subject participates in binding key to isolate different users", async () => {
  const router = new IdentityRouter(new MemoryBindingStore(), exampleIdentities);
  await router.bind(meta("alice", "same-chat"), "dev");
  assert.equal((await router.identify(meta("bob", "same-chat"))).registered, false);
});

test("rebinding replaces role, repeated binding is idempotent", async () => {
  const router = new IdentityRouter(new MemoryBindingStore(), exampleIdentities);
  const call = meta("alice", "session");
  await router.bind(call, "qa");
  await router.bind(call, "qa");
  await router.bind(call, "design");
  assert.equal((await router.identify(call)).identity?.displayName, "UI/UX Designer");
});

test("missing subject/session fail closed and never land in one unknown bucket", async () => {
  for (const invalid of [undefined, {}, { "openai/session": "s" }, { "openai/subject": "u" }, meta("", "s")]) {
    await assert.rejects(getChatIdentity(invalid), (error: unknown) =>
      error instanceof IdentityError && error.code === "CHAT_METADATA_MISSING");
  }
});

test("unknown role rejected without storing a binding", async () => {
  const router = new IdentityRouter(new MemoryBindingStore(), exampleIdentities);
  const call = meta("alice", "s");
  await assert.rejects(router.bind(call, "admin"), (error: unknown) =>
    error instanceof IdentityError && error.code === "IDENTITY_NOT_FOUND");
  assert.equal((await router.identify(call)).registered, false);
});

test("metadata fingerprint is deterministic and does not expose input identifiers", async () => {
  const call = meta("alice", "my-conversation");
  const first = await getChatIdentity(call);
  const second = await getChatIdentity(call);
  assert.equal(first.key, second.key);
  assert.match(first.fingerprint, /^[0-9a-f]{12}$/);
  assert.ok(!first.key.includes("alice"));
  assert.ok(!first.key.includes("conversation"));
});
