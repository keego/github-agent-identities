import assert from "node:assert/strict";
import { test } from "node:test";
import { verifiedTenantFromContext } from "../src/verified-tenant.ts";

test("OAuth client ID alone never identifies a tenant", () => {
  const ctx = { http: { authInfo: { clientId: "chatgpt-oauth-client", scopes: ["github:write"] } } };
  assert.equal(verifiedTenantFromContext(ctx), undefined);
});

test("client-supplied MCP metadata cannot impersonate a verified tenant", () => {
  const ctx = {
    _meta: { tenantId: "alice", "openai/subject": "alice" },
    http: { authInfo: { clientId: "chatgpt-oauth-client" } },
  };
  assert.equal(verifiedTenantFromContext(ctx), undefined);
});

test("verified principal from auth middleware supplies tenant identity", () => {
  const ctx = {
    _meta: { "openai/subject": "pseudonymous-user" },
    http: { authInfo: {
      clientId: "chatgpt-oauth-client",
      extra: { tenantId: "verified-tenant-42" },
    } },
  };
  assert.equal(verifiedTenantFromContext(ctx), "verified-tenant-42");
});

test("missing and whitespace tenant IDs fail closed", () => {
  assert.equal(verifiedTenantFromContext(undefined), undefined);
  assert.equal(verifiedTenantFromContext({ http: { authInfo: { extra: { tenantId: "  " } } } }), undefined);
});
