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
  appId: 67890, installationId: 98765,
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
  assert.equal(await provider.forApp(sandbox), "token-for-67890-98765");
  await provider.forApp(designer);
  await provider.forApp(sandbox);
  assert.deepEqual(accesses, ["GH_APP_DESIGN_PRIVATE_KEY", "GH_APP_SANDBOX_PRIVATE_KEY"]);
});
