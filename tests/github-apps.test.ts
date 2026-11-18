import assert from "node:assert/strict";
import { test } from "node:test";
import { D1AppRegistry, MemoryAppRegistry, assertRepositoryAllowed, type AppIdentity } from "../src/github-apps.ts";
import { InstallationTokenProvider } from "../src/github-auth.ts";

const designer: AppIdentity = {
  identityId: "design",
  displayName: "UI/UX Designer",
  appId: 5808833,
  installationId: 123,
  secretRef: "GH_APP_DESIGN_PRIVATE_KEY",
  allowedRepositories: ["keego/poster-brain"],
};

test("registry isolates identities by authenticated tenant ID", async () => {
  const registry = new MemoryAppRegistry();
  registry.setForTenant("alice", [designer]);
  assert.deepEqual(await registry.listForTenant("alice"), [designer]);
  assert.deepEqual(await registry.listForTenant("bob"), []);
  assert.equal(await registry.getForTenant("bob", "design"), null);
});

test("repository permission check is explicit and case-insensitive", () => {
  assert.doesNotThrow(() => assertRepositoryAllowed(designer, "KEEGO/POSTER-BRAIN"));
  assert.throws(() => assertRepositoryAllowed(designer, "keego/another-repo"));
});

test("token provider caches short-lived tokens and refreshes before expiry", async () => {
  let now = 1_000_000;
  let calls = 0;
  const provider = new InstallationTokenProvider(
    async () => "fake-private-key",
    async () => {
      calls++;
      return { token: "test-token-" + calls, expiresAt: new Date(now + 3_600_000).toISOString() };
    },
    () => now,
  );
  assert.equal(await provider.forApp(designer), "test-token-1");
  assert.equal(await provider.forApp(designer), "test-token-1");
  assert.equal(calls, 1);
  now += 3_550_000;
  assert.equal(await provider.forApp(designer), "test-token-2");
  assert.equal(calls, 2);
});

test("missing keys fail closed and never call the issuer", async () => {
  let called = false;
  const provider = new InstallationTokenProvider(async () => null, async () => {
    called = true; return { token: "x", expiresAt: new Date(Date.now() + 1e6).toISOString() };
  });
  await assert.rejects(provider.forApp(designer), /not configured/);
  assert.equal(called, false);
});

test("issuer failures do not leak private key or low-level errors", async () => {
  const provider = new InstallationTokenProvider(
    async () => "super-secret-key",
    async () => { throw new Error("super-secret-key leaked"); },
  );
  await assert.rejects(provider.forApp(designer), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Failed to authenticate GitHub App installation");
    return true;
  });
});

test("D1 registry queries are tenant-scoped and parameters are bound", async () => {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const row = {
    identity_id: designer.identityId,
    display_name: designer.displayName,
    app_id: designer.appId,
    installation_id: designer.installationId,
    secret_ref: designer.secretRef,
    allowed_repos_json: JSON.stringify(designer.allowedRepositories),
  };
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...params: unknown[]) { args = params; return statement; },
        async first<T>() { queries.push({ sql, args }); return row as T; },
        async all<T>() { queries.push({ sql, args }); return { results: [row] as T[] }; },
      };
      return statement;
    },
  };
  const registry = new D1AppRegistry(db);
  assert.equal((await registry.getForTenant("tenant-A", "design"))?.appId, designer.appId);
  assert.equal((await registry.listForTenant("tenant-A")).length, 1);
  assert.deepEqual(queries[0].args, ["tenant-A", "design"]);
  assert.deepEqual(queries[1].args, ["tenant-A"]);
  assert.ok(queries.every(q => q.sql.includes("tenant_id = ?1")));
});
