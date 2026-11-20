import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SignJWT, createLocalJWKSet, exportJWK, generateKeyPair,
  type JWTVerifyGetKey,
} from "jose";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { handlePrivateWorker, type WorkerEnv } from "../src/worker.ts";

const issuer = "https://private-team.cloudflareaccess.com";
const audience = "0123456789abcdef0123456789abcdef";
type AgentRow = {
  identity_id: string; display_name: string;
  app_id: number; installation_id: number;
  secret_ref: string; allowed_repos_json: string;
};

function fakeDatabase(): WorkerEnv["DB"] {
  const bindings = new Map<string, string>();
  const apps: Record<string, AgentRow[]> = {
    "cloudflare-access:alice-id": [{
      identity_id: "design",
      display_name: "UI/UX Designer",
      app_id: 5808833,
      installation_id: 183125278,
      secret_ref: "GH_APP_DESIGN_PRIVATE_KEY",
      allowed_repos_json: JSON.stringify(["keego/poster-brain"]),
    }],
    "cloudflare-access:bob-id": [{
      identity_id: "qa",
      display_name: "QA Engineer",
      app_id: 200,
      installation_id: 300,
      secret_ref: "GH_APP_QA_PRIVATE_KEY",
      allowed_repos_json: JSON.stringify(["example/qa-project"]),
    }],
  };
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...params: unknown[]) { values = params; return statement; },
        async first<T>(): Promise<T | null> {
          if (sql.includes("conversation_bindings")) {
            const id = bindings.get(String(values[0]));
            return (id ? { identity_id: id } : null) as T | null;
          }
          if (sql.includes("github_app_identities")) {
            const row = (apps[String(values[0])] ?? [])
              .find(identity => identity.identity_id === String(values[1]));
            return (row ?? null) as T | null;
          }
          throw new Error("Unexpected first query");
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes("github_app_identities")) {
            return { results: (apps[String(values[0])] ?? []) as T[] };
          }
          throw new Error("Unexpected all query");
        },
        async run() {
          if (sql.includes("INSERT INTO conversation_bindings")) {
            bindings.set(String(values[0]), String(values[1]));
            return {};
          }
          throw new Error("Unexpected write");
        },
      };
      return statement;
    },
  } as WorkerEnv["DB"];
}

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "signing-test", alg: "RS256", use: "sig" };
  const resolver: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });
  async function token(userId: string, email: string, options: {
    expiresIn?: string; audience?: string;
  } = {}) {
    return new SignJWT({ type: "app", email })
      .setProtectedHeader({ alg: "RS256", kid: "signing-test" })
      .setSubject(userId)
      .setIssuer(issuer)
      .setAudience(options.audience ?? audience)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "15m")
      .sign(privateKey);
  }
  const env: WorkerEnv = {
    DB: fakeDatabase(),
    MCP_PUBLIC_HOSTNAME: "private.example.workers.dev",
    ACCESS_ISSUER: issuer,
    ACCESS_AUDIENCE: audience,
    ALLOWED_ACCESS_EMAILS: "alice@example.com,bob@example.com",
  };
  function clientFor(assertion?: string) {
    const transport = new StreamableHTTPClientTransport(
      new URL("https://private.example.workers.dev/mcp"),
      {
        fetch(url, init) {
          const headers = new Headers(init?.headers);
          // Native Cloudflare HTTP requests include Host; Node Request() does not.
          headers.set("Host", "private.example.workers.dev");
          if (assertion) headers.set("Cf-Access-Jwt-Assertion", assertion);
          return handlePrivateWorker(
            new Request(url, { ...init, headers }),
            env, resolver,
          );
        },
      },
    );
    const client = new Client(
      { name: "access-integrated-mcp-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    return { transport, client };
  }
  return { token, env, resolver, clientFor };
}
function parse(result: { content?: Array<{ type: string; text?: string }> }) {
  return JSON.parse(result.content?.[0]?.text ?? "{}") as {
    ok: boolean; registered?: boolean;
    identity?: { id: string } | null;
    identities?: Array<{ id: string }>;
    availableIdentities?: Array<{ id: string }>;
  };
}

test("unauthenticated requests fail before any MCP tool is reachable", async () => {
  const { env, resolver, clientFor } = await setup();
  const res = await handlePrivateWorker(
    new Request("https://private.example.workers.dev/mcp", {
      method: "POST", headers: { Host: "private.example.workers.dev" },
    }),
    env, resolver,
  );
  assert.equal(res.status, 401);
  const { client, transport } = clientFor();
  await assert.rejects(client.connect(transport));
  await client.close();
});

test("two invited humans get tenant-specific identity lists and independent chat bindings", async () => {
  const { token, clientFor } = await setup();
  const alice = clientFor(await token("alice-id", "alice@example.com"));
  const bob = clientFor(await token("bob-id", "bob@example.com"));
  const meta = {
    "openai/subject": "same-anonymized-subject",
    "openai/session": "same-session-string",
    "tenantId": "spoofed-tenant-ignored",
  };
  try {
    await alice.client.connect(alice.transport);
    await bob.client.connect(bob.transport);
    const aList = parse(await alice.client.callTool({ name: "list_identities", arguments: {} }));
    const bList = parse(await bob.client.callTool({ name: "list_identities", arguments: {} }));
    assert.deepEqual(aList.identities?.map(item => item.id), ["design"]);
    assert.deepEqual(bList.identities?.map(item => item.id), ["qa"]);

    // Tenant IDs are only available *after* authentication, and cannot be
    // supplied by clients. They allow secure private App registry onboarding.
    const aAccount = await alice.client.callTool({ name: "get_my_tenant_id", arguments: {} });
    const bAccount = await bob.client.callTool({ name: "get_my_tenant_id", arguments: {} });
    const aTenant = JSON.parse(aAccount.content?.[0]?.type === "text" ? aAccount.content[0].text : "{}");
    const bTenant = JSON.parse(bAccount.content?.[0]?.type === "text" ? bAccount.content[0].text : "{}");
    assert.equal(aTenant.tenantId, "cloudflare-access:alice-id");
    assert.equal(bTenant.tenantId, "cloudflare-access:bob-id");

    const aBind = parse(await alice.client.callTool({
      name: "bind_identity", arguments: { identityId: "design" }, _meta: meta,
    }));
    assert.equal(aBind.identity?.id, "design");

    const bState = parse(await bob.client.callTool({
      name: "identify_chat", arguments: {}, _meta: meta,
    }));
    assert.equal(bState.registered, false);
    const denied = await bob.client.callTool({
      name: "bind_identity", arguments: { identityId: "design" }, _meta: meta,
    });
    assert.equal(denied.isError, true);
    const bBind = parse(await bob.client.callTool({
      name: "bind_identity", arguments: { identityId: "qa" }, _meta: meta,
    }));
    assert.equal(bBind.identity?.id, "qa");
    const aAgain = parse(await alice.client.callTool({
      name: "get_current_identity", arguments: {}, _meta: meta,
    }));
    assert.equal(aAgain.identity?.id, "design");

    const tools = await alice.client.listTools();
    assert.equal(tools.tools.some(item => item.name === "github_comment_on_pr"), false);
    assert.equal(tools.tools.some(item => item.name === "github_get_pull_request"), false);
  } finally {
    await alice.client.close();
    await bob.client.close();
  }
});

test("signed uninvited user cannot obtain identity list or bind a session", async () => {
  const { token, clientFor } = await setup();
  const stranger = clientFor(await token("stranger-id", "stranger@example.net"));
  await assert.rejects(stranger.client.connect(stranger.transport));
  await stranger.client.close();
});


test("GitHub App reads are opt-in and never expose comment writes", async () => {
  const { token, clientFor, env } = await setup();
  env.GH_APP_READONLY_ENABLED = "true";
  const alice = clientFor(await token("alice-id", "alice@example.com"));
  const metadata = {
    "openai/subject": "same-user",
    "openai/session": "pilot-session",
    "tenantId": "cloudflare-access:bob-id", // spoofed, must be ignored
  };

  try {
    await alice.client.connect(alice.transport);
    const available = await alice.client.listTools();
    assert.equal(available.tools.some(tool => tool.name === "github_get_pull_request"), true);
    assert.equal(available.tools.some(tool => tool.name === "github_comment_on_pr"), false);

    // An unbound chat cannot perform any GitHub action, regardless of tenant metadata.
    const unbound = await alice.client.callTool({
      name: "github_get_pull_request",
      arguments: { repository: "keego/poster-brain", number: 1 },
      _meta: metadata,
    });
    assert.equal(unbound.isError, true);

    const bound = await alice.client.callTool({
      name: "bind_identity",
      arguments: { identityId: "design" }, _meta: metadata,
    });
    assert.equal(bound.isError, undefined);

    // Repo allowlist check happens before any GitHub token request.
    const forbidden = await alice.client.callTool({
      name: "github_get_pull_request",
      arguments: { repository: "keego/not-authorized", number: 1 }, _meta: metadata,
    });
    assert.equal(forbidden.isError, true);
    assert.match(forbidden.content?.[0]?.type === "text" ? forbidden.content[0].text : "",
      /REPOSITORY_NOT_ALLOWED/);

    // Deliberately no PEM secret: no real GitHub HTTP request can happen.
    const noSecret = await alice.client.callTool({
      name: "github_get_pull_request",
      arguments: { repository: "keego/poster-brain", number: 1 }, _meta: metadata,
    });
    assert.equal(noSecret.isError, true);
    assert.match(noSecret.content?.[0]?.type === "text" ? noSecret.content[0].text : "",
      /APP_SECRET_UNAVAILABLE/);
    assert.equal(available.tools.some(tool => tool.name === "github_comment_on_pr"), false);
  } finally {
    await alice.client.close();
  }
});

test("GitHub-read opt-in never permits unauthenticated access", async () => {
  const { env, resolver } = await setup();
  env.GH_APP_READONLY_ENABLED = "true";
  const response = await handlePrivateWorker(
    new Request("https://private.example.workers.dev/mcp", {
      method: "POST", headers: { Host: "private.example.workers.dev" },
    }), env, resolver,
  );
  assert.equal(response.status, 401);
});


test("fresh Access assertion after reconnect preserves binding for the same signed human", async () => {
  const { token, clientFor } = await setup();
  const meta = { "openai/subject": "shared-chat-subject", "openai/session": "reconnected-chat" };
  const initial = clientFor(await token("alice-id", "alice@example.com"));
  try {
    await initial.client.connect(initial.transport);
    const bind = parse(await initial.client.callTool({
      name: "bind_identity", arguments: { identityId: "design" }, _meta: meta,
    }));
    assert.equal(bind.identity?.id, "design");
  } finally {
    await initial.client.close();
  }

  // A new signed Access assertion and brand-new MCP client must select
  // the same tenant-scoped binding, not an OAuth client/session ID.
  const renewed = clientFor(await token("alice-id", "alice@example.com"));
  const differentSubject = clientFor(await token("distinct-access-subject", "alice@example.com"));
  try {
    await renewed.client.connect(renewed.transport);
    const state = parse(await renewed.client.callTool({
      name: "get_current_identity", arguments: {}, _meta: meta,
    }));
    assert.equal(state.registered, true);
    assert.equal(state.identity?.id, "design");

    // Even the same allowlisted email and identical MCP metadata must NOT
    // inherit a different verified Access subject's binding or App list.
    await differentSubject.client.connect(differentSubject.transport);
    const foreign = parse(await differentSubject.client.callTool({
      name: "get_current_identity", arguments: {}, _meta: meta,
    }));
    assert.equal(foreign.registered, false);
    const apps = parse(await differentSubject.client.callTool({
      name: "list_identities", arguments: {},
    }));
    assert.deepEqual(apps.identities, []);
  } finally {
    await renewed.client.close();
    await differentSubject.client.close();
  }
});

test("Worker rejects an already-signed user's token after allowlist revocation", async () => {
  const { token, env, resolver, clientFor } = await setup();
  const aliceJwt = await token("alice-id", "alice@example.com");

  // Establish that the exact assertion was authorized before the revocation.
  const active = clientFor(aliceJwt);
  try {
    await active.client.connect(active.transport);
    const before = parse(await active.client.callTool({ name: "list_identities", arguments: {} }));
    assert.deepEqual(before.identities?.map(identity => identity.id), ["design"]);

    // The actual authenticated HTTP boundary re-evaluates the Worker allowlist
    // on every MCP request; a still cryptographically valid JWT is insufficient.
    env.ALLOWED_ACCESS_EMAILS = "bob@example.com";
    const denied = await handlePrivateWorker(
      new Request("https://private.example.workers.dev/mcp", {
        method: "POST",
        headers: {
          Host: "private.example.workers.dev",
          "Cf-Access-Jwt-Assertion": aliceJwt,
        },
      }), env, resolver,
    );
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { ok: false, error: "NOT_ALLOWED" });

    // A separate connection using the already-issued JWT must also fail.
    const replay = clientFor(aliceJwt);
    try {
      await assert.rejects(replay.client.connect(replay.transport));
    } finally {
      await replay.client.close();
    }
  } finally {
    await active.client.close();
  }
});

test("expired and wrong-audience signed assertions cannot reach any MCP tool", async () => {
  const { token, env, resolver } = await setup();
  for (const jwt of [
    await token("alice-id", "alice@example.com", { expiresIn: "-10m" }),
    await token("alice-id", "alice@example.com", { audience: "different-access-app-audience" }),
  ]) {
    const response = await handlePrivateWorker(
      new Request("https://private.example.workers.dev/mcp", {
        method: "POST",
        headers: {
          Host: "private.example.workers.dev",
          "Cf-Access-Jwt-Assertion": jwt,
        },
      }), env, resolver,
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "UNAUTHENTICATED" });
  }
});

test("two bound tenants cannot read each other's GitHub App repositories", async () => {
  const { token, clientFor, env } = await setup();
  env.GH_APP_READONLY_ENABLED = "true";
  // No real PEM secrets: successful repo authorization stops at the
  // deterministic missing-secret check rather than making GitHub HTTP calls.
  const alice = clientFor(await token("alice-id", "alice@example.com"));
  const bob = clientFor(await token("bob-id", "bob@example.com"));
  const meta = {
    "openai/subject": "same-shared-subject",
    "openai/session": "same-shared-session",
    tenantId: "cloudflare-access:alice-id",
    clientId: "spoofed-client",
  };
  const read = async (client: Client, repository: string) => {
    const result = await client.callTool({
      name: "github_get_pull_request",
      arguments: { repository, number: 22 },
      _meta: meta,
    });
    assert.equal(result.isError, true);
    const output = result.content?.[0]?.type === "text" ? result.content[0].text : "{}";
    return JSON.parse(output) as { ok: false; error: string };
  };
  try {
    await alice.client.connect(alice.transport);
    await bob.client.connect(bob.transport);

    const aBind = await alice.client.callTool({
      name: "bind_identity", arguments: { identityId: "design" }, _meta: meta,
    });
    const bBind = await bob.client.callTool({
      name: "bind_identity", arguments: { identityId: "qa" }, _meta: meta,
    });
    assert.notEqual(aBind.isError, true);
    assert.notEqual(bBind.isError, true);

    assert.equal((await read(alice.client, "keego/poster-brain")).error, "APP_SECRET_UNAVAILABLE");
    assert.equal((await read(bob.client, "example/qa-project")).error, "APP_SECRET_UNAVAILABLE");
    assert.equal((await read(alice.client, "example/qa-project")).error, "REPOSITORY_NOT_ALLOWED");
    assert.equal((await read(bob.client, "keego/poster-brain")).error, "REPOSITORY_NOT_ALLOWED");
    assert.equal((await read(alice.client, "keego/other")).error, "REPOSITORY_NOT_ALLOWED");
  } finally {
    await alice.client.close();
    await bob.client.close();
  }
});
