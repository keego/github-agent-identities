import assert from "node:assert/strict";
import { test } from "node:test";
import { IdentityRouter, MemoryBindingStore, exampleIdentities } from "../src/core.ts";
import { MemoryAppRegistry, type AppIdentity } from "../src/github-apps.ts";
import { GitHubOperations, GithubOperationError, type VerifiedCaller } from "../src/github-operations.ts";

const app: AppIdentity = {
  identityId: "design",
  displayName: "UI/UX Designer",
  appId: 5808833,
  installationId: 123,
  secretRef: "GH_APP_DESIGN_PRIVATE_KEY",
  allowedRepositories: ["keego/poster-brain"],
};
const caller = (tenantId = "tenant-A", session = "session-A"): VerifiedCaller => ({
  tenantId,
  metadata: { "openai/subject": "user-A", "openai/session": session },
});

function fixture() {
  const router = new IdentityRouter(new MemoryBindingStore(), exampleIdentities);
  const registry = new MemoryAppRegistry();
  registry.setForTenant("tenant-A", [app]);
  const calls: Array<{ url: string; method: string; authorization: string; body: string | null }> = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input), method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization") ?? "",
      body: typeof init?.body === "string" ? init.body : null,
    });
    const isPost = init?.method === "POST";
    return new Response(JSON.stringify(isPost
      ? { id: 88, html_url: "https://github.com/keego/poster-brain/pull/3#issuecomment-88", user: { login: "poster-brain-design[bot]" } }
      : { number: 3, title: "Test", state: "open", body: "PR", html_url: "https://github.com/keego/poster-brain/pull/3", user: { login: "developer" } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const operations = new GitHubOperations(router, registry, { forApp: async () => "fake-installation-token" }, fakeFetch as typeof fetch);
  return { router, registry, operations, calls };
}

test("reads PR as the App bound to the authenticated tenant's conversation", async () => {
  const { router, operations, calls } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  const pr = await operations.getPullRequest(caller(), "keego/poster-brain", 3);
  assert.equal(pr.title, "Test");
  assert.equal(calls[0].authorization, "Bearer fake-installation-token");
  assert.equal(calls[0].url, "https://api.github.com/repos/keego/poster-brain/pulls/3");
});

test("posting a PR comment uses installation credentials and returns safe fields", async () => {
  const { router, operations, calls } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  const result = await operations.commentOnPullRequest(caller(), "keego/poster-brain", 3, "Design looks good");
  assert.equal(result.author, "poster-brain-design[bot]");
  assert.equal(calls[0].method, "POST");
  assert.equal(JSON.parse(calls[0].body ?? "{}").body, "Design looks good");
  assert.equal(JSON.stringify(result).includes("fake-installation-token"), false);
});

test("missing binding, unauthorized repository and foreign tenants never call GitHub", async () => {
  const { router, operations, calls } = fixture();
  await assert.rejects(operations.getPullRequest(caller(), "keego/poster-brain", 3), (e: unknown) =>
    e instanceof GithubOperationError && e.code === "IDENTITY_NOT_BOUND");
  await router.bind(caller().metadata, "design", "tenant-A");
  await assert.rejects(operations.getPullRequest(caller(), "keego/other", 3), (e: unknown) =>
    e instanceof GithubOperationError && e.code === "REPOSITORY_NOT_ALLOWED");
  await assert.rejects(operations.getPullRequest(caller("tenant-B"), "keego/poster-brain", 3), (e: unknown) =>
    e instanceof GithubOperationError && e.code === "IDENTITY_NOT_BOUND");
  assert.equal(calls.length, 0);
});

test("GitHub 403 responses are sanitized", async () => {
  const { router, registry } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  const failure = new GitHubOperations(router, registry, { forApp: async () => "fake" },
    (async () => new Response("sensitive remote response", { status: 403 })) as typeof fetch);
  await assert.rejects(failure.getPullRequest(caller(), "keego/poster-brain", 3), (e: unknown) =>
    e instanceof GithubOperationError && e.code === "GITHUB_REQUEST_FAILED");
});

test("invalid numbers and comment bodies fail before network calls", async () => {
  const { router, operations, calls } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  await assert.rejects(operations.getPullRequest(caller(), "keego/poster-brain", 0));
  await assert.rejects(operations.commentOnPullRequest(caller(), "keego/poster-brain", 3, " "));
  assert.equal(calls.length, 0);
});
