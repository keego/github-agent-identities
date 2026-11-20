import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { IdentityRouter, MemoryBindingStore, exampleIdentities } from "../src/core.ts";
import { MemoryAppRegistry, type AppIdentity } from "../src/github-apps.ts";
import { GitHubOperations } from "../src/github-operations.ts";
import { createIdentityMcpServer } from "../src/server.ts";

test("real MCP calls surface sanitized one-shot PR failure diagnostics for bound chats", async () => {
  const tenantId = "verified-test-tenant";
  const metadata = { "openai/subject": "test-human", "openai/session": "test-session" };
  const router = new IdentityRouter(new MemoryBindingStore(), exampleIdentities);
  const registry = new MemoryAppRegistry();
  const identity: AppIdentity = {
    identityId: "design", displayName: "UI/UX Designer",
    appId: 5808833, installationId: 183125278,
    secretRef: "GH_APP_DESIGN_PRIVATE_KEY",
    allowedRepositories: ["keego/poster-brain"],
  };
  registry.setForTenant(tenantId, [identity]);

  let networkCalls = 0;
  const operations = new GitHubOperations(
    router, registry, { forApp: async () => "synthetic-installation-token" },
    (async (input: RequestInfo | URL) => {
      networkCalls++;
      const url = String(input);
      if (url.endsWith("/pulls/22")) return new Response("private upstream body", { status: 403 });
      if (url.endsWith("/repos/keego/poster-brain")) return Response.json({ private: true });
      if (url.endsWith("/installation/repositories?per_page=100")) {
        return Response.json({ total_count: 1, repositories: [{ full_name: "keego/poster-brain" }] });
      }
      throw new Error("Unexpected URL");
    }) as typeof fetch,
  );
  const handler = createMcpHandler(
    () => createIdentityMcpServer(router, operations, tenantId),
    { responseMode: "json" },
  );
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.test/mcp"), {
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Host", "mcp.test");
      return handler.fetch(new Request(url, { ...init, headers }));
    },
  });
  const client = new Client(
    { name: "github-read-diagnostic-integration", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  try {
    await client.connect(transport);
    const preBind = await client.callTool({
      name: "github_get_pull_request",
      arguments: { repository: "keego/poster-brain", number: 22 },
      _meta: metadata,
    });
    assert.equal(preBind.isError, true);
    assert.match(preBind.content?.[0]?.type === "text" ? preBind.content[0].text : "", /IDENTITY_NOT_BOUND/);
    assert.equal(networkCalls, 0);

    const bound = await client.callTool({
      name: "bind_identity", arguments: { identityId: "design" }, _meta: metadata,
    });
    assert.notEqual(bound.isError, true);

    const read = await client.callTool({
      name: "github_get_pull_request",
      arguments: { repository: "keego/poster-brain", number: 22 }, _meta: metadata,
    });
    assert.equal(read.isError, true);
    const response = JSON.parse(read.content?.[0]?.type === "text" ? read.content[0].text : "{}") as {
      ok: boolean; error: string; diagnostics?: {
        pullRequest: { kind: string; status: number | null };
        repository: { status: number | null };
        installation: { status: number | null; repositorySelected: boolean | null; listComplete: boolean | null };
      };
    };
    assert.equal(response.ok, false);
    assert.equal(response.error, "GITHUB_REQUEST_FORBIDDEN");
    assert.deepEqual(response.diagnostics, {
      pullRequest: { kind: "http", status: 403 },
      repository: { status: 200 },
      installation: { status: 200, repositorySelected: true, listComplete: true },
    });
    assert.equal(JSON.stringify(response).includes("synthetic-installation-token"), false);
    assert.equal(JSON.stringify(response).includes("private upstream body"), false);
    assert.equal(networkCalls, 3);
  } finally {
    await client.close();
  }
});
