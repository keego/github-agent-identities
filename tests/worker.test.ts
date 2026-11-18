import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker.ts";
import type { WorkerEnv } from "../src/worker.ts";

test("Worker responds to health without exposing MCP capability", async () => {
  const response = await worker.fetch(new Request("https://mcp.example.org/health"), {} as WorkerEnv);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "healthy");
});

test("Worker disables MCP by default even if DB is configured", async () => {
  const env = { DB: {} as WorkerEnv["DB"], MCP_PUBLIC_HOSTNAME: "mcp.example.org" };
  const response = await worker.fetch(new Request("https://mcp.example.org/mcp", { method: "POST" }), env);
  assert.equal(response.status, 503);
});

test("Worker refuses incomplete demo configuration", async () => {
  const env = { ENABLE_UNAUTHENTICATED_DEMO: "true", MCP_PUBLIC_HOSTNAME: "mcp.example.org" } as WorkerEnv;
  const response = await worker.fetch(new Request("https://mcp.example.org/mcp", { method: "POST" }), env);
  assert.equal(response.status, 503);
});

test("Worker rejects requests on unexpected Host before touching D1", async () => {
  const env = {
    ENABLE_UNAUTHENTICATED_DEMO: "true",
    MCP_PUBLIC_HOSTNAME: "mcp.example.org",
    DB: { prepare: () => { throw new Error("DB access should not happen"); } },
  } as WorkerEnv;
  const response = await worker.fetch(new Request("https://evil.example.org/mcp", { method: "POST" }), env);
  assert.equal(response.status, 403);
});
