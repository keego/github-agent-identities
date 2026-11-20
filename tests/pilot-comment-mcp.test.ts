import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { IdentityRouter, MemoryBindingStore, exampleIdentities } from "../src/core.ts";
import { MemoryAppRegistry } from "../src/github-apps.ts";
import { GitHubOperations } from "../src/github-operations.ts";
import { PILOT_COMMENT_CONFIRMATION, PILOT_COMMENT_TEXT } from "../src/comment-pilot.ts";
import { createIdentityMcpServer } from "../src/server.ts";

test("actual MCP transport exposes only gated fixed-text, single-attempt bot POST", async () => {
  const owner = "cloudflare-access:synthetic-owner";
  const metadata = { "openai/subject": "owner", "openai/session": "comment-chat" };
  const router = new IdentityRouter(new MemoryBindingStore(), exampleIdentities);
  const registry = new MemoryAppRegistry();
  registry.setForTenant(owner, [{
    identityId: "design", displayName: "UI/UX Designer",
    appId: 5808833, installationId: 183125278,
    secretRef: "GH_APP_DESIGN_PRIVATE_KEY", allowedRepositories: ["keego/poster-brain"],
  }]);
  let claims = 0, posts = 0;
  const operations = new GitHubOperations(router, registry,
    { forApp: async () => "synthetic-app-token" },
    (async (url: RequestInfo | URL, init?: RequestInit) => {
      posts++;
      assert.equal(String(url), "https://api.github.com/repos/keego/poster-brain/issues/22/comments");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-app-token");
      assert.deepEqual(JSON.parse(String(init?.body)), { body: PILOT_COMMENT_TEXT });
      return Response.json({
        id: 810, html_url: "https://github.com/keego/poster-brain/pull/22#issuecomment-810",
        user: { login: "poster-designer[bot]" },
      });
    }) as typeof fetch,
    { ownerTenantId: owner, repository: "keego/poster-brain", number: 22,
      claims: {
        claim: async () => ++claims === 1,
        complete: async () => {},
      },
    });
  const disabled = createIdentityMcpServer(router, operations, owner);
  // A proper implementation should only be activated with the operator flag.
  assert.ok(disabled);
  const handler = createMcpHandler(
    () => createIdentityMcpServer(router, operations, owner, true),
    { responseMode: "json" },
  );
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.test/mcp"), {
    fetch: (url, init) => {
      const headers = new Headers(init?.headers); headers.set("Host", "mcp.test");
      return handler.fetch(new Request(url, { ...init, headers }));
    },
  });
  const client = new Client({ name: "pilot-comment-client", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } });
  async function post(repository: string, number: number, confirmation = PILOT_COMMENT_CONFIRMATION) {
    const tool = await client.callTool({
      name: "github_post_pilot_comment", arguments: { repository, number, confirmation },
      _meta: metadata,
    });
    return JSON.parse(tool.content?.[0]?.type === "text" ? tool.content[0].text : "{}") as {
      ok: boolean; error?: string; result?: { author?: string; botAttributed?: boolean; auditRecorded?: boolean };
    };
  }
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const pilot = tools.tools.find(t => t.name === "github_post_pilot_comment");
    assert.ok(pilot);
    assert.equal(pilot.annotations?.readOnlyHint, false);
    assert.equal(pilot.annotations?.destructiveHint, true);
    assert.equal(pilot.annotations?.idempotentHint, false);
    assert.equal(tools.tools.some(t => t.name === "github_comment_on_pr"), false);
    assert.equal((await post("keego/poster-brain", 22)).error, "IDENTITY_NOT_BOUND");
    await client.callTool({ name: "bind_identity", arguments: { identityId: "design" }, _meta: metadata });
    assert.equal((await post("keego/unauthorized", 22)).error, "PILOT_TARGET_NOT_ALLOWED");
    const success = await post("keego/poster-brain", 22);
    assert.equal(success.ok, true);
    assert.equal(success.result?.author, "poster-designer[bot]");
    assert.equal(success.result?.botAttributed, true);
    assert.equal(success.result?.auditRecorded, true);
    assert.equal((await post("keego/poster-brain", 22)).error, "PILOT_ALREADY_ATTEMPTED");
    assert.equal(posts, 1);
  } finally {
    await client.close();
  }
});
