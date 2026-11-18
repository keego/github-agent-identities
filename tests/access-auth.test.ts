import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SignJWT, createLocalJWKSet, exportJWK, generateKeyPair,
  type JWTVerifyGetKey,
} from "jose";
import { accessSettings, authenticateAccess } from "../src/access-auth.ts";

const issuer = "https://my-team.cloudflareaccess.com";
const audience = "1234567890abcdef1234567890abcdef";
const config = {
  ACCESS_ISSUER: issuer,
  ACCESS_AUDIENCE: audience,
  ALLOWED_ACCESS_EMAILS: " Alice@Example.com , bob@example.com ",
};

async function fixture() {
  const keys = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
  const resolver = createLocalJWKSet({ keys: [jwk] });
  async function sign(
    claims: Record<string, unknown> = {},
    options: { issuer?: string; audience?: string; expiresIn?: string } = {},
  ) {
    return new SignJWT({
      type: "app",
      email: "alice@example.com",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
      .setSubject("verified-user-uuid")
      .setIssuer(options.issuer ?? issuer)
      .setAudience(options.audience ?? audience)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "15m")
      .sign(keys.privateKey);
  }
  return { sign, resolver: resolver as JWTVerifyGetKey };
}
function req(jwt?: string, meta?: string) {
  const headers = new Headers();
  if (jwt) headers.set("Cf-Access-Jwt-Assertion", jwt);
  if (meta) headers.set("x-fake-tenant", meta);
  return new Request("https://mcp.test.workers.dev/mcp", { method: "POST", headers });
}

test("Access settings reject incomplete, non-Cloudflare, or empty allowlists", () => {
  assert.equal(accessSettings({}), null);
  assert.equal(accessSettings({ ...config, ACCESS_ISSUER: "https://attacker.example.net" }), null);
  assert.equal(accessSettings({ ...config, ACCESS_ISSUER: "http://my-team.cloudflareaccess.com" }), null);
  assert.equal(accessSettings({ ...config, ACCESS_ISSUER: "https://my-team.cloudflareaccess.com.evil.test" }), null);
  assert.equal(accessSettings({ ...config, ALLOWED_ACCESS_EMAILS: "" }), null);
  assert.equal(accessSettings({ ...config, ACCESS_AUDIENCE: "short" }), null);
  assert.equal(accessSettings({ ...config, ALLOWED_ACCESS_EMAILS: "not-an-email" }), null);
  const settings = accessSettings(config);
  assert.ok(settings);
  assert.deepEqual([...settings.allowedEmails], ["alice@example.com", "bob@example.com"]);
});

test("verified JWT yields stable tenant, not client or MCP metadata identity", async () => {
  const { sign, resolver } = await fixture();
  const settings = accessSettings(config)!;
  const res = await authenticateAccess(req(await sign(), "spoofed-tenant"), settings, resolver);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.principal.tenantId, "cloudflare-access:verified-user-uuid");
    assert.equal(res.principal.email, "alice@example.com");
  }
});

test("missing, malformed, invalid-signature and wrong-audience assertions are rejected", async () => {
  const { sign, resolver } = await fixture();
  const settings = accessSettings(config)!;
  assert.equal((await authenticateAccess(req(), settings, resolver)).ok, false);
  assert.equal((await authenticateAccess(req("not.a.jwt"), settings, resolver)).ok, false);
  const wrongAudience = await sign({}, { audience: "otheraudience1234567890" });
  assert.equal((await authenticateAccess(req(wrongAudience), settings, resolver)).ok, false);
  const wrongIssuer = await sign({}, { issuer: "https://another.cloudflareaccess.com" });
  assert.equal((await authenticateAccess(req(wrongIssuer), settings, resolver)).ok, false);
  const other = await fixture();
  assert.equal((await authenticateAccess(req(await other.sign()), settings, resolver)).ok, false);
});

test("invited-user allowlist and human-only subject are enforced", async () => {
  const { sign, resolver } = await fixture();
  const settings = accessSettings(config)!;
  const uninvited = await authenticateAccess(req(await sign({ email: "not-invited@example.org" })), settings, resolver);
  assert.deepEqual(uninvited, { ok: false, status: 403, code: "NOT_ALLOWED" });
  const noEmail = await authenticateAccess(req(await sign({ email: "" })), settings, resolver);
  assert.equal(noEmail.ok, false);
  const service = await authenticateAccess(req(await sign({ type: "service" })), settings, resolver);
  assert.equal(service.ok, false);
  const expired = await authenticateAccess(req(await sign({}, { expiresIn: "-5m" })), settings, resolver);
  assert.equal(expired.ok, false);
});
