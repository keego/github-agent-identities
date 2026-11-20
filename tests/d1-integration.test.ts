import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Miniflare } from "miniflare";
import { D1BindingStore } from "../src/d1-store.ts";
import { D1PilotCommentClaims } from "../src/comment-pilot.ts";
import { IdentityRouter, exampleIdentities } from "../src/core.ts";
import worker from "../src/worker.ts";

const databaseId = "f8c4180b-7f7b-4b0d-b3d7-152c52f4f720";
const session = (subject: string, chat: string) => ({
  "openai/subject": subject,
  "openai/session": chat,
});

function runtime(persistPath: string) {
  return new Miniflare({
    modules: true,
    script: "export default { fetch: () => new Response('test-worker') }",
    // Stable Miniflare v4 binary currently supports dates through 2026-08-06.
    // These tests cover the D1 adapter, not production runtime compatibility.
    compatibilityDate: "2026-08-06",
    d1Databases: { DB: databaseId },
    // Miniflare v4 uses a per-resource persistence option; v5 uses
    // resourcePersistencePath instead.
    d1Persist: persistPath,
  });
}

async function applyMigrations(mf: Miniflare) {
  const db = await mf.getD1Database("DB");
  for (const migration of [
    "migrations/0001_conversation_bindings.sql",
    "migrations/0002_github_app_identities.sql",
    "migrations/0003_pilot_comment_attempts.sql",
  ]) {
    // Miniflare's D1 exec() treats a comment-only line as an invalid SQL
    // statement. Prepare each statement from our two simple SQL migrations,
    // stripping standalone comments before executing it.
    const source = await readFile(path.join(process.cwd(), migration), "utf8");
    const sql = source.split("\n")
      .filter(line => !line.trimStart().startsWith("--")).join("\n");
    for (const statement of sql.split(";").map(item => item.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  return db;
}

test("real local D1 executes all SQL migrations, persists bindings, isolates chats and survives reopen", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "github-agent-identities-d1-"));
  let mf = runtime(dir);
  try {
    const db = await applyMigrations(mf);
    const tables = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('conversation_bindings', 'github_app_identities', 'pilot_comment_attempts') ORDER BY name"
    ).all<{ name: string }>();
    assert.deepEqual(tables.results.map((row: { name: string }) => row.name), [
      "conversation_bindings", "github_app_identities", "pilot_comment_attempts",
    ]);

    const a = new IdentityRouter(new D1BindingStore(db), exampleIdentities);
    await a.bind(session("alice", "chat-1"), "design", "tenant-A");
    await a.bind(session("alice", "chat-2"), "qa", "tenant-A");
    assert.equal((await a.identify(session("bob", "chat-1"), "tenant-A")).registered, false);
    assert.equal((await a.identify(session("alice", "chat-1"), "tenant-B")).registered, false);

    await mf.dispose();
    mf = runtime(dir); // Equivalent to restarting the local Cloudflare resource.
    const newDb = await mf.getD1Database("DB");
    const b = new IdentityRouter(new D1BindingStore(newDb), exampleIdentities);
    assert.equal((await b.identify(session("alice", "chat-1"), "tenant-A")).identity?.id, "design");
    assert.equal((await b.identify(session("alice", "chat-2"), "tenant-A")).identity?.id, "qa");

    await b.bind(session("alice", "chat-1"), "dev", "tenant-A");
    assert.equal((await b.identify(session("alice", "chat-2"), "tenant-A")).identity?.id, "qa");
    assert.equal((await b.identify(session("alice", "chat-1"), "tenant-A")).identity?.id, "dev");
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("real D1 rejects writes before migration; Worker denies MCP without explicit authenticated setup", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "github-agent-identities-empty-"));
  const mf = runtime(dir);
  try {
    const db = await mf.getD1Database("DB");
    const router = new IdentityRouter(new D1BindingStore(db), exampleIdentities);
    await assert.rejects(router.bind(session("u", "s"), "design", "tenant-A"));

    // No real GitHub credentials or public MCP tools should be reachable by default.
    const response = await worker.fetch(
      new Request("https://mcp.invalid.example/mcp", {
        method: "POST", headers: { Host: "mcp.invalid.example" },
      }),
      {
        DB: db,
        MCP_PUBLIC_HOSTNAME: "mcp.invalid.example",
      },
    );
    assert.equal(response.status, 503);
    assert.match(await response.text(), /AUTH_NOT_CONFIGURED/);
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("real D1 one-shot comment claim is atomic, persistent and scoped without storing body", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "github-agent-identities-comment-"));
  let mf = runtime(dir);
  try {
    const db = await applyMigrations(mf);
    const claims = new D1PilotCommentClaims(db);
    assert.equal(await claims.claim("tenant-A", "keego/poster-brain", 22, "design"), true);
    assert.equal(await claims.claim("tenant-A", "keego/poster-brain", 22, "design"), false);
    assert.equal(await claims.claim("tenant-B", "keego/poster-brain", 22, "qa"), true);
    assert.equal(await claims.claim("tenant-A", "keego/poster-brain", 23, "design"), true);
    await claims.complete("tenant-A", "keego/poster-brain", 22,
      99, "https://github.com/keego/poster-brain/pull/22#issuecomment-99", "poster-designer[bot]");

    const row = await db.prepare(
      "SELECT identity_id, state, github_comment_id, github_author FROM pilot_comment_attempts " +
      "WHERE tenant_id = ?1 AND repository = ?2 AND pr_number = ?3"
    ).bind("tenant-A", "keego/poster-brain", 22).first<{
      identity_id: string; state: string; github_comment_id: number; github_author: string;
    }>();
    assert.deepEqual(row, {
      identity_id: "design", state: "posted", github_comment_id: 99, github_author: "poster-designer[bot]",
    });
    const schema = await db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='pilot_comment_attempts'"
    ).first<{ sql: string }>();
    assert.ok(schema?.sql);
    assert.equal(schema.sql.includes("comment_body"), false);
    assert.equal(schema.sql.includes("access_token"), false);

    await mf.dispose();
    mf = runtime(dir);
    const newDb = await mf.getD1Database("DB");
    const afterRestart = new D1PilotCommentClaims(newDb);
    assert.equal(await afterRestart.claim("tenant-A", "keego/poster-brain", 22, "design"), false);
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("pilot claims fail closed before the new migration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "github-agent-identities-comment-unmigrated-"));
  const mf = runtime(dir);
  try {
    const claims = new D1PilotCommentClaims(await mf.getD1Database("DB"));
    await assert.rejects(claims.claim("tenant-A", "keego/poster-brain", 22, "design"));
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
