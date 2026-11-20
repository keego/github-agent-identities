import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Miniflare } from "miniflare";
import { D1BindingStore } from "../src/d1-store.ts";
import { D1AppRegistry } from "../src/github-apps.ts";
import { createTenantRouter } from "../src/tenant-router.ts";
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

test("real D1 supports two independent GitHub Apps for one owner without leaking into another tenant", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "github-agent-identities-multi-app-"));
  let mf = runtime(dir);
  try {
    const db = await applyMigrations(mf);
    const apps = [
      { identityId: "design", display: "UI/UX Designer", appId: 5808833,
        installationId: 183125278, secretRef: "GH_APP_DESIGN_PRIVATE_KEY",
        repos: ["keego/poster-brain"] },
      { identityId: "ghai-sandbox", display: "GHAI Sandbox Bot", appId: 67890,
        installationId: 98765, secretRef: "GH_APP_SANDBOX_PRIVATE_KEY",
        repos: ["keego/github-agent-identities"] },
    ];
    for (const app of apps) {
      await db.prepare(
        "INSERT INTO github_app_identities " +
        "(tenant_id, identity_id, display_name, app_id, installation_id, secret_ref, allowed_repos_json) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
      ).bind("cloudflare-access:synthetic-owner", app.identityId, app.display,
        app.appId, app.installationId, app.secretRef, JSON.stringify(app.repos)).run();
    }
    const registry = new D1AppRegistry(db);
    const owner = "cloudflare-access:synthetic-owner";
    const stranger = "cloudflare-access:synthetic-other";
    const installed = await registry.listForTenant(owner);
    assert.equal(installed.length, 2);
    assert.deepEqual(installed.map(x => x.identityId), ["ghai-sandbox", "design"]);
    assert.deepEqual(installed.find(x => x.identityId === "design")?.allowedRepositories,
      ["keego/poster-brain"]);
    assert.deepEqual(installed.find(x => x.identityId === "ghai-sandbox")?.allowedRepositories,
      ["keego/github-agent-identities"]);
    assert.deepEqual(await registry.listForTenant(stranger), []);
    assert.equal(await registry.getForTenant(stranger, "ghai-sandbox"), null);

    const router = await createTenantRouter(new D1BindingStore(db), registry, owner);
    const original = session("owner", "designer-chat");
    const sandbox = session("owner", "sandbox-chat");
    await router.bind(original, "design", owner);
    await router.bind(sandbox, "ghai-sandbox", owner);
    assert.equal((await router.identify(original, owner)).identity?.id, "design");
    assert.equal((await router.identify(sandbox, owner)).identity?.id, "ghai-sandbox");

    const foreign = await createTenantRouter(new D1BindingStore(db), registry, stranger);
    assert.deepEqual(foreign.list(), []);
    assert.equal((await foreign.identify(sandbox, stranger)).registered, false);

    await mf.dispose();
    mf = runtime(dir);
    const afterRestart = await mf.getD1Database("DB");
    const newRegistry = new D1AppRegistry(afterRestart);
    const refreshed = await createTenantRouter(new D1BindingStore(afterRestart), newRegistry, owner);
    assert.equal((await refreshed.identify(original, owner)).identity?.id, "design");
    assert.equal((await refreshed.identify(sandbox, owner)).identity?.id, "ghai-sandbox");
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
