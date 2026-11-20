import assert from "node:assert/strict";
import { test } from "node:test";
import { IdentityRouter, MemoryBindingStore, exampleIdentities } from "../src/core.ts";
import { AppTokenError } from "../src/github-auth.ts";
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
    e instanceof GithubOperationError && e.code === "GITHUB_REQUEST_FORBIDDEN" &&
      !String(e).includes("sensitive remote response"));
});

test("invalid numbers and comment bodies fail before network calls", async () => {
  const { router, operations, calls } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  await assert.rejects(operations.getPullRequest(caller(), "keego/poster-brain", 0));
  await assert.rejects(operations.commentOnPullRequest(caller(), "keego/poster-brain", 3, " "));
  assert.equal(calls.length, 0);
});


test("safe App-token diagnostics reach the operation boundary without exposing upstream errors", async () => {
  const { router, registry } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  const failed = new GitHubOperations(router, registry, {
    forApp: async () => { throw new AppTokenError("APP_JWT_SIGNING_FAILED"); },
  });
  await assert.rejects(
    failed.getPullRequest(caller(), "keego/poster-brain", 3),
    (error: unknown) => error instanceof GithubOperationError &&
      error.code === "APP_JWT_SIGNING_FAILED" &&
      !String(error).includes("secret"),
  );
});

test("registry failures return safe stage classification instead of raw SQL failures", async () => {
  const { router } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  const failed = new GitHubOperations(router, {
    getForTenant: async () => { throw new Error("sensitive: raw SQL details"); },
    listForTenant: async () => [],
  }, { forApp: async () => "unused" });
  await assert.rejects(
    failed.getPullRequest(caller(), "keego/poster-brain", 3),
    (error: unknown) => error instanceof GithubOperationError && error.code === "APP_REGISTRY_FAILED",
  );
});


test("GitHub PR HTTP failures are classified without exposing upstream details", async () => {
  const { router, registry } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  const cases: ReadonlyArray<{
    status: number; headers?: Record<string, string>; expected: string;
  }> = [
    { status: 400, expected: "GITHUB_BAD_REQUEST" },
    { status: 401, expected: "GITHUB_REQUEST_UNAUTHORIZED" },
    { status: 403, expected: "GITHUB_REQUEST_FORBIDDEN" },
    { status: 403, headers: { "x-ratelimit-remaining": "0" }, expected: "GITHUB_RATE_LIMITED" },
    { status: 404, expected: "GITHUB_RESOURCE_NOT_FOUND_OR_INACCESSIBLE" },
    { status: 422, expected: "GITHUB_BAD_REQUEST" },
    { status: 429, expected: "GITHUB_RATE_LIMITED" },
    { status: 502, expected: "GITHUB_SERVICE_UNAVAILABLE" },
    { status: 418, expected: "GITHUB_REQUEST_FAILED" },
  ];
  for (const { status, headers, expected } of cases) {
    const failure = new GitHubOperations(router, registry, { forApp: async () => "sensitive-token" },
      (async () => new Response("secret, remote response or token", { status, headers })) as typeof fetch);
    await assert.rejects(failure.getPullRequest(caller(), "keego/poster-brain", 22), (error: unknown) => {
      assert.equal(error instanceof GithubOperationError, true);
      assert.equal((error as GithubOperationError).code, expected);
      assert.equal((error as Error).message, expected);
      assert.equal(String(error).includes("secret"), false);
      assert.equal(String(error).includes("sensitive-token"), false);
      return true;
    });
  }
});

test("GitHub PR fetch transport failures still use safe generic errors", async () => {
  const { router, registry } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  const failure = new GitHubOperations(router, registry, { forApp: async () => "sensitive-token" },
    (async () => { throw new Error("private connection details"); }) as typeof fetch);
  await assert.rejects(failure.getPullRequest(caller(), "keego/poster-brain", 22), (error: unknown) =>
    error instanceof GithubOperationError && error.code === "GITHUB_REQUEST_FAILED" &&
    !error.message.includes("private connection details"));
});


test("one failed PR read runs read-only visibility and installation-selection checks", async () => {
  const { router, registry } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
  const operations = new GitHubOperations(router, registry, { forApp: async () => "test-token" },
    (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url), method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      if (String(url).endsWith("/pulls/22")) return new Response("upstream-secret", { status: 403 });
      if (String(url).endsWith("/repos/keego/poster-brain")) return Response.json({ private: true });
      if (String(url).endsWith("/installation/repositories?per_page=100")) {
        return Response.json({ total_count: 1, repositories: [{ full_name: "keego/poster-brain" }] });
      }
      throw new Error("Unexpected API request");
    }) as typeof fetch);
  await assert.rejects(operations.getPullRequest(caller(), "keego/poster-brain", 22), (error: unknown) => {
    assert.ok(error instanceof GithubOperationError);
    assert.equal(error.code, "GITHUB_REQUEST_FORBIDDEN");
    assert.deepEqual(error.diagnostics, {
      pullRequest: { kind: "http", status: 403 },
      repository: { status: 200 },
      installation: { status: 200, repositorySelected: true, listComplete: true },
    });
    assert.equal(JSON.stringify(error.diagnostics).includes("upstream-secret"), false);
    assert.equal(JSON.stringify(error.diagnostics).includes("test-token"), false);
    return true;
  });
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.method === "GET"));
  assert.ok(requests.every(request => request.authorization === "Bearer test-token"));
});

test("installation repo membership is false only after a complete list, never a partial page", async () => {
  const { router, registry } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  for (const totalCount of [0, 101]) {
    const operation = new GitHubOperations(router, registry, { forApp: async () => "test-token" },
      (async (url: RequestInfo | URL) => {
        if (String(url).endsWith("/pulls/22")) return new Response("", { status: 404 });
        if (String(url).endsWith("/repos/keego/poster-brain")) return new Response("", { status: 404 });
        return Response.json({
          total_count: totalCount,
          repositories: totalCount === 101
            ? Array.from({ length: 100 }, (_, i) => ({ full_name: "other/repo-" + i }))
            : [],
        });
      }) as typeof fetch);
    await assert.rejects(operation.getPullRequest(caller(), "keego/poster-brain", 22), (error: unknown) => {
      assert.ok(error instanceof GithubOperationError);
      assert.equal(error.code, "GITHUB_RESOURCE_NOT_FOUND_OR_INACCESSIBLE");
      assert.deepEqual(error.diagnostics?.pullRequest, { kind: "http", status: 404 });
      assert.equal(error.diagnostics?.repository.status, 404);
      assert.equal(error.diagnostics?.installation.repositorySelected, totalCount === 0 ? false : null);
      assert.equal(error.diagnostics?.installation.listComplete, totalCount === 0);
      return true;
    });
  }
});

test("unexpected installation listing and transport failures never expose raw errors", async () => {
  const { router, registry } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  const malformed = new GitHubOperations(router, registry, { forApp: async () => "token" },
    (async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/pulls/22")) return new Response("{", { status: 200 });
      if (String(url).endsWith("/repos/keego/poster-brain")) return new Response("", { status: 200 });
      return Response.json({ total_count: 5, repositories: "raw-upstream-untrusted" });
    }) as typeof fetch);
  await assert.rejects(malformed.getPullRequest(caller(), "keego/poster-brain", 22), (error: unknown) => {
    assert.ok(error instanceof GithubOperationError);
    assert.equal(error.code, "GITHUB_REQUEST_FAILED");
    assert.deepEqual(error.diagnostics, {
      pullRequest: { kind: "invalid_json", status: 200 },
      repository: { status: 200 },
      installation: { status: 200, repositorySelected: null, listComplete: null },
    });
    assert.equal(JSON.stringify(error.diagnostics).includes("raw-upstream-untrusted"), false);
    return true;
  });
  const offline = new GitHubOperations(router, registry, { forApp: async () => "token" },
    (async () => { throw new Error("private-network-details"); }) as typeof fetch);
  await assert.rejects(offline.getPullRequest(caller(), "keego/poster-brain", 22), (error: unknown) => {
    assert.ok(error instanceof GithubOperationError);
    assert.deepEqual(error.diagnostics, {
      pullRequest: { kind: "transport", status: null },
      repository: { status: null },
      installation: { status: null, repositorySelected: null, listComplete: null },
    });
    assert.equal(JSON.stringify(error).includes("private-network-details"), false);
    return true;
  });
});

test("unbound and unauthorized repositories never make diagnostic API requests", async () => {
  const { router, registry } = fixture();
  let tokenCalls = 0, apiCalls = 0;
  const operation = new GitHubOperations(router, registry, {
    forApp: async () => { tokenCalls++; return "token"; },
  }, (async () => { apiCalls++; throw new Error("must not run"); }) as typeof fetch);
  await assert.rejects(operation.getPullRequest(caller(), "keego/poster-brain", 22),
    (error: unknown) => error instanceof GithubOperationError && error.code === "IDENTITY_NOT_BOUND");
  await router.bind(caller().metadata, "design", "tenant-A");
  await assert.rejects(operation.getPullRequest(caller(), "other/repo", 22),
    (error: unknown) => error instanceof GithubOperationError && error.code === "REPOSITORY_NOT_ALLOWED");
  assert.equal(tokenCalls, 0);
  assert.equal(apiCalls, 0);
});

test("successful PR read performs no additional installation diagnostics", async () => {
  const { router, operations, calls } = fixture();
  await router.bind(caller().metadata, "design", "tenant-A");
  assert.equal((await operations.getPullRequest(caller(), "keego/poster-brain", 22)).title, "Test");
  assert.equal(calls.length, 1);
});
