import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryBindingStore } from "../src/core.ts";
import { MemoryAppRegistry, type AppIdentity } from "../src/github-apps.ts";
import { createTenantRouter } from "../src/tenant-router.ts";

function app(id: string, name: string): AppIdentity {
  return {
    identityId: id, displayName: name, appId: 5808833,
    installationId: 100, secretRef: "GH_APP_TEST_PRIVATE_KEY",
    allowedRepositories: ["keego/poster-brain"],
  };
}
const meta = { "openai/subject": "same-user", "openai/session": "same-session" };

test("identity choices come only from authenticated tenant's App list", async () => {
  const reg = new MemoryAppRegistry();
  reg.setForTenant("tenant-A", [app("design", "UI/UX Designer")]);
  reg.setForTenant("tenant-B", [app("qa", "QA Engineer")]);
  const store = new MemoryBindingStore();
  const a = await createTenantRouter(store, reg, "tenant-A");
  const b = await createTenantRouter(store, reg, "tenant-B");
  assert.deepEqual(a.list().map(x => x.id), ["design"]);
  assert.deepEqual(b.list().map(x => x.id), ["qa"]);
  await a.bind(meta, "design", "tenant-A");
  assert.equal((await b.identify(meta, "tenant-B")).registered, false);
  await assert.rejects(b.bind(meta, "design", "tenant-B"));
});

test("binding to a removed identity results in an unregistered state", async () => {
  const reg = new MemoryAppRegistry();
  const store = new MemoryBindingStore();
  reg.setForTenant("tenant-A", [app("design", "UI/UX Designer")]);
  const first = await createTenantRouter(store, reg, "tenant-A");
  await first.bind(meta, "design", "tenant-A");
  reg.setForTenant("tenant-A", [app("qa", "QA Engineer")]);
  const second = await createTenantRouter(store, reg, "tenant-A");
  const state = await second.identify(meta, "tenant-A");
  assert.equal(state.registered, false);
  assert.equal(state.identity, null);
  assert.deepEqual(second.list().map(x => x.displayName), ["QA Engineer"]);
});

test("missing tenant is not permitted", async () => {
  await assert.rejects(createTenantRouter(new MemoryBindingStore(), new MemoryAppRegistry(), ""));
});
