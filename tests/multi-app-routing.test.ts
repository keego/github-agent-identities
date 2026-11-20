import assert from "node:assert/strict";
import { test } from "node:test";
import { IdentityRouter, MemoryBindingStore } from "../src/core.ts";
import { MemoryAppRegistry, type AppIdentity } from "../src/github-apps.ts";
import { GitHubOperations, GithubOperationError } from "../src/github-operations.ts";
import { InstallationTokenProvider } from "../src/github-auth.ts";

const tenant = "cloudflare-access:synthetic-owner";
const designer: AppIdentity = {
  identityId: "design", displayName: "UI/UX Designer",
  appId: 5808833, installationId: 183125278,
  secretRef: "GH_APP_DESIGN_PRIVATE_KEY",
  allowedRepositories: ["keego/poster-brain"],
};
const sandbox: AppIdentity = {
  identityId: "ghai-sandbox", displayName: "GHAI Sandbox Bot",
  appId: 5855759, installationId: 184190090,
  secretRef: "GH_APP_SANDBOX_PRIVATE_KEY",
  allowedRepositories: ["keego/github-agent-identities"],
};
const designerChat = { "openai/subject": "same-human", "openai/session": "designer-conversation" };
const sandboxChat = { "openai/subject": "same-human", "openai/session": "sandbox-conversation" };
const caller = (metadata: typeof designerChat) => ({ tenantId: tenant, metadata });

test("two GitHub Apps in the same tenant are bound to separate chats and use separate installation credentials", async () => {
  const registry = new MemoryAppRegistry();
  registry.setForTenant(tenant, [designer, sandbox]);
  const router = new IdentityRouter(new MemoryBindingStore(), [
    { id: designer.identityId, displayName: designer.displayName },
    { id: sandbox.identityId, displayName: sandbox.displayName },
  ]);
  await router.bind(designerChat, "design", tenant);
  await router.bind(sandboxChat, "ghai-sandbox", tenant);

  const calls: Array<{url: string; authorization: string}> = [];
  const requested: string[] = [];
  const operations = new GitHubOperations(router, registry, {
    forApp: async (app) => {
      requested.push(app.secretRef);
      return app.secretRef === designer.secretRef ? "designer-token" : "sandbox-token";
    },
  }, (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      authorization: new Headers(init?.headers).get("Authorization") ?? "",
    });
    return Response.json({
      number: 1, title: "Fixture", state: "open", body: null,
      html_url: "https://github.com/example/example/pull/1",
      user: {login: "tester"},
    });
  }) as typeof fetch);

  await operations.getPullRequest(caller(designerChat), "keego/poster-brain", 1);
  await operations.getPullRequest(caller(sandboxChat), "keego/github-agent-identities", 1);
  assert.deepEqual(requested, ["GH_APP_DESIGN_PRIVATE_KEY", "GH_APP_SANDBOX_PRIVATE_KEY"]);
  assert.deepEqual(calls, [
    {url: "https://api.github.com/repos/keego/poster-brain/pulls/1", authorization: "Bearer designer-token"},
    {url: "https://api.github.com/repos/keego/github-agent-identities/pulls/1", authorization: "Bearer sandbox-token"},
  ]);

  await assert.rejects(
    operations.getPullRequest(caller(sandboxChat), "keego/poster-brain", 1),
    e => e instanceof GithubOperationError && e.code === "REPOSITORY_NOT_ALLOWED",
  );
  await assert.rejects(
    operations.getPullRequest(caller(designerChat), "keego/github-agent-identities", 1),
    e => e instanceof GithubOperationError && e.code === "REPOSITORY_NOT_ALLOWED",
  );
  assert.equal(calls.length, 2);
  assert.equal((await router.identify(designerChat, tenant)).identity?.id, "design");
  assert.equal((await router.identify(sandboxChat, tenant)).identity?.id, "ghai-sandbox");
});

test("installation token caching never aliases two App installations or secret references", async () => {
  const accesses: string[] = [];
  const provider = new InstallationTokenProvider(
    async ref => { accesses.push(ref); return "synthetic-private-key"; },
    async ({appId, installationId}) => ({
      token: `token-for-${appId}-${installationId}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  );
  assert.equal(await provider.forApp(designer), "token-for-5808833-183125278");
  assert.equal(await provider.forApp(sandbox), "token-for-5855759-184190090");
  await provider.forApp(designer);
  await provider.forApp(sandbox);
  assert.deepEqual(accesses, ["GH_APP_DESIGN_PRIVATE_KEY", "GH_APP_SANDBOX_PRIVATE_KEY"]);
});

test("stateless 520+ character installation tokens remain opaque, untruncated and distinct by App", async () => {
  // The new stateless format is ghs_APPID_JWT; these are inert synthetic
  // strings, not signed credentials. GitHub tokens must not be parsed by us.
  const newFormat = "ghs_5855759_" +
    "a".repeat(170) + "." + "b".repeat(170) + "." + "c".repeat(170);
  const legacyFormat = "ghs_" + "x".repeat(36);
  assert.ok(newFormat.length >= 520);
  const requests: Array<{ url: string; auth: string }> = [];
  let issued = 0;
  const tokens = new InstallationTokenProvider(
    async () => "synthetic-private-key-never-used-for-signing",
    async ({ appId }) => {
      issued++;
      return {
        token: appId === sandbox.appId ? newFormat : legacyFormat,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
    },
  );
  const registry = new MemoryAppRegistry();
  registry.setForTenant(tenant, [designer, sandbox]);
  const router = new IdentityRouter(new MemoryBindingStore(), [
    { id: designer.identityId, displayName: designer.displayName },
    { id: sandbox.identityId, displayName: sandbox.displayName },
  ]);
  await router.bind(designerChat, "design", tenant);
  await router.bind(sandboxChat, "ghai-sandbox", tenant);
  const operations = new GitHubOperations(router, registry, tokens,
    (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        auth: new Headers(init?.headers).get("Authorization") ?? "",
      });
      return Response.json({
        number: 1, title: "Synthetic PR", state: "open", body: null,
        html_url: "https://github.com/example/synthetic/pull/1",
        user: { login: "synthetic-author" },
      });
    }) as typeof fetch,
  );
  await operations.getPullRequest(caller(designerChat), "keego/poster-brain", 1);
  await operations.getPullRequest(caller(sandboxChat), "keego/github-agent-identities", 1);
  await operations.getPullRequest(caller(sandboxChat), "keego/github-agent-identities", 1);
  assert.equal(requests[0].auth, "Bearer " + legacyFormat);
  assert.equal(requests[1].auth, "Bearer " + newFormat);
  assert.equal(requests[2].auth, "Bearer " + newFormat);
  assert.equal(requests[1].auth.length, "Bearer ".length + newFormat.length);
  assert.equal(issued, 2); // Subsequent Sandbox reads use the cache without mixing Apps.
});
