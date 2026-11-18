import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { IdentityRouter, MemoryBindingStore, exampleIdentities } from "../src/core.ts";
import { createIdentityMcpServer } from "../src/server.ts";

function toolData(reply: { content?: Array<{ type: string; text?: string }> }) {
  const first = reply.content?.[0];
  assert.equal(first?.type, "text");
  return JSON.parse(first?.text ?? "{}") as {
    ok: boolean;
    registered?: boolean;
    identity?: { id: string } | null;
    fingerprint?: string;
  };
}

test("MCP HTTP transport binds two independent conversation identities", async () => {
  const router = new IdentityRouter(new MemoryBindingStore(), exampleIdentities);
  const handler = createMcpHandler(() => createIdentityMcpServer(router), {
    responseMode: "json",
  });
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client(
    { name: "identity-integration-test", version: "0.1.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const metaA = { "openai/subject": "user", "openai/session": "chat-A" };
  const metaB = { "openai/subject": "user", "openai/session": "chat-B" };

  try {
    await client.connect(transport);
    const before = toolData(await client.callTool({
      name: "identify_chat", arguments: {}, _meta: metaA,
    }));
    assert.equal(before.ok, true);
    assert.equal(before.registered, false);

    const a = toolData(await client.callTool({
      name: "bind_identity", arguments: { identityId: "design" }, _meta: metaA,
    }));
    assert.equal(a.ok, true);
    assert.equal(a.identity?.id, "design");

    const b = toolData(await client.callTool({
      name: "bind_identity", arguments: { identityId: "qa" }, _meta: metaB,
    }));
    assert.equal(b.ok, true);
    assert.equal(b.identity?.id, "qa");
    assert.notEqual(a.fingerprint, b.fingerprint);

    const aAgain = toolData(await client.callTool({
      name: "get_current_identity", arguments: {}, _meta: metaA,
    }));
    assert.equal(aAgain.identity?.id, "design");
    assert.equal(aAgain.fingerprint, a.fingerprint);
  } finally {
    await client.close();
    await handler.close();
  }
});
