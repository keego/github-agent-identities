import assert from "node:assert/strict";
import { test } from "node:test";
import { IdentityRouter, MemoryBindingStore, exampleIdentities } from "../src/core.ts";
import { MemoryAppRegistry } from "../src/github-apps.ts";
import { GitHubOperations, GithubOperationError } from "../src/github-operations.ts";
import { AppTokenError } from "../src/github-auth.ts";
import { PILOT_COMMENT_CONFIRMATION, PILOT_COMMENT_TEXT } from "../src/comment-pilot.ts";

const owner = "cloudflare-access:owner";
const meta = { "openai/subject": "human", "openai/session": "session" };
const caller = (tenantId = owner) => ({ tenantId, metadata: meta });

function setup() {
  const router = new IdentityRouter(new MemoryBindingStore(), exampleIdentities);
  const registry = new MemoryAppRegistry();
  registry.setForTenant(owner, [{
    identityId: "design", displayName: "UI/UX Designer", appId: 5808833,
    installationId: 183125278, secretRef: "GH_APP_DESIGN_PRIVATE_KEY",
    allowedRepositories: ["keego/poster-brain"],
  }]);
  let attempted = false, claims = 0, completed = 0, posted = 0;
  const scope = {
    ownerTenantId: owner, repository: "keego/poster-brain", number: 22,
    claims: {
      claim: async () => { claims++; if (attempted) return false; attempted = true; return true; },
      complete: async () => { completed++; },
    },
  };
  const mockFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    posted++;
    assert.equal(String(url), "https://api.github.com/repos/keego/poster-brain/issues/22/comments");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-token");
    assert.deepEqual(JSON.parse(String(init?.body)), { body: PILOT_COMMENT_TEXT });
    return Response.json({
      id: 501, html_url: "https://github.com/keego/poster-brain/pull/22#issuecomment-501",
      user: { login: "poster-designer[bot]" },
    });
  }) as typeof fetch;
  const tokens = { forApp: async () => "synthetic-token" };
  const operations = new GitHubOperations(router, registry, tokens, mockFetch, scope);
  return { router, registry, scope, mockFetch, tokens, operations,
    counts: () => ({ posted, claims, completed }) };
}
const isError = (code: string) => (error: unknown) =>
  error instanceof GithubOperationError && error.code === code;

test("one approved bound App POST returns actual bot attribution and blocks repetition", async () => {
  const { router, operations, counts } = setup();
  await router.bind(meta, "design", owner);
  const result = await operations.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 22, PILOT_COMMENT_CONFIRMATION);
  assert.deepEqual(result, {
    id: 501, url: "https://github.com/keego/poster-brain/pull/22#issuecomment-501",
    author: "poster-designer[bot]", botAttributed: true, auditRecorded: true,
  });
  await assert.rejects(operations.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 22, PILOT_COMMENT_CONFIRMATION), isError("PILOT_ALREADY_ATTEMPTED"));
  assert.deepEqual(counts(), { posted: 1, claims: 2, completed: 1 });
});

test("no tool write without verified owner, allowed target, explicit approval or bound role", async () => {
  const { router, registry, tokens, mockFetch, scope, operations, counts } = setup();
  const absent = new GitHubOperations(router, registry, tokens, mockFetch);
  await assert.rejects(absent.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 22, PILOT_COMMENT_CONFIRMATION), isError("PILOT_WRITE_DISABLED"));
  await assert.rejects(operations.commentOnPilotPullRequest(
    caller("cloudflare-access:other"), "keego/poster-brain", 22, PILOT_COMMENT_CONFIRMATION),
  isError("PILOT_WRITE_DISABLED"));
  await assert.rejects(operations.commentOnPilotPullRequest(
    caller(), "keego/other", 22, PILOT_COMMENT_CONFIRMATION), isError("PILOT_TARGET_NOT_ALLOWED"));
  await assert.rejects(operations.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 23, PILOT_COMMENT_CONFIRMATION), isError("PILOT_TARGET_NOT_ALLOWED"));
  await assert.rejects(operations.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 22, "not-approved"), isError("PILOT_CONFIRMATION_REQUIRED"));
  await assert.rejects(operations.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 22, PILOT_COMMENT_CONFIRMATION), isError("IDENTITY_NOT_BOUND"));
  await router.bind(meta, "design", owner);
  const disallowed = new GitHubOperations(router, registry, tokens, mockFetch,
    { ...scope, repository: "other/hidden" });
  await assert.rejects(disallowed.commentOnPilotPullRequest(
    caller(), "other/hidden", 22, PILOT_COMMENT_CONFIRMATION), isError("REPOSITORY_NOT_ALLOWED"));
  assert.deepEqual(counts(), { posted: 0, claims: 0, completed: 0 });
});

test("App key failure does not claim; transport failure claims once and prevents retry", async () => {
  const { router, registry, scope, counts } = setup();
  await router.bind(meta, "design", owner);
  let dispatched = 0;
  const appFailure = new GitHubOperations(router, registry, {
    forApp: async () => { throw new AppTokenError("APP_SECRET_UNAVAILABLE"); },
  }, (async () => { dispatched++; throw new Error("should not dispatch"); }) as typeof fetch, scope);
  await assert.rejects(appFailure.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 22, PILOT_COMMENT_CONFIRMATION), isError("APP_SECRET_UNAVAILABLE"));
  assert.equal(counts().claims, 0);
  const transport = new GitHubOperations(router, registry, { forApp: async () => "synthetic-token" },
    (async () => { dispatched++; throw new Error("private transport error"); }) as typeof fetch, scope);
  await assert.rejects(transport.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 22, PILOT_COMMENT_CONFIRMATION), isError("GITHUB_REQUEST_FAILED"));
  await assert.rejects(transport.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 22, PILOT_COMMENT_CONFIRMATION), isError("PILOT_ALREADY_ATTEMPTED"));
  assert.equal(dispatched, 1);
  assert.equal(counts().claims, 2);
});

test("audit claim failure denies POST, completion failure reports posted status without retry", async () => {
  const { router, registry, mockFetch } = setup();
  await router.bind(meta, "design", owner);
  const invalid = new GitHubOperations(router, registry, { forApp: async () => "synthetic-token" },
    mockFetch, { ownerTenantId: owner, repository: "keego/poster-brain", number: 22,
      claims: { claim: async () => { throw new Error("private SQL"); }, complete: async () => {} },
    });
  await assert.rejects(invalid.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 22, PILOT_COMMENT_CONFIRMATION), isError("PILOT_AUDIT_UNAVAILABLE"));
  const partial = new GitHubOperations(router, registry, { forApp: async () => "synthetic-token" },
    mockFetch, { ownerTenantId: owner, repository: "keego/poster-brain", number: 22,
      claims: { claim: async () => true, complete: async () => { throw new Error("private SQL"); } },
    });
  const result = await partial.commentOnPilotPullRequest(
    caller(), "keego/poster-brain", 22, PILOT_COMMENT_CONFIRMATION);
  assert.equal(result.botAttributed, true);
  assert.equal(result.auditRecorded, false);
});
