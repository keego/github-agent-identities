import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { AppTokenError, InstallationTokenProvider, octokitTokenIssuer } from "../src/github-auth.ts";
import type { AppIdentity } from "../src/github-apps.ts";

const identity: AppIdentity = {
  identityId: "design", displayName: "UI/UX Designer", appId: 5808833,
  installationId: 183125278, secretRef: "GH_APP_DESIGN_PRIVATE_KEY",
  allowedRepositories: ["keego/poster-brain"],
};
const at = Date.parse("2026-11-19T20:00:00Z");

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) =>
    error instanceof AppTokenError && error.code === code && error.message === code);
}

test("missing private key and invalid secret reference use safe errors", async () => {
  const noKey = new InstallationTokenProvider(async () => null);
  await expectCode(noKey.forApp(identity), "APP_SECRET_UNAVAILABLE");
  await expectCode(noKey.forApp({ ...identity, secretRef: "not-an-approved-secret" }), "APP_SECRET_REF_INVALID");
  const rejected = new InstallationTokenProvider(async () => { throw new Error("sensitive secret backend"); });
  await expectCode(rejected.forApp(identity), "APP_SECRET_UNAVAILABLE");
});

test("invalid App private key is classified at local JWT-signing stage, never returned", async () => {
  await expectCode(octokitTokenIssuer({
    appId: identity.appId, installationId: identity.installationId,
    privateKey: "not-a-private-key",
  }), "APP_JWT_SIGNING_FAILED");
});

test("Octokit signs a synthetic PKCS#1 GitHub-style key without contacting GitHub", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const syntheticPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
  const auth = createAppAuth({ appId: identity.appId, privateKey: syntheticPem });
  const result = await auth({ type: "app" });
  assert.match(result.token, /^[^.]+\\.[^.]+\\.[^.]+$/);
  assert.equal(result.appId, identity.appId);
});

test("installation issuance failure is sanitized, while typed stages are preserved", async () => {
  const provider = new InstallationTokenProvider(async () => "test-only-private-key",
    async () => { throw new Error("sensitive upstream GitHub response"); }, () => at);
  await expectCode(provider.forApp(identity), "APP_INSTALLATION_TOKEN_FAILED");
  const typed = new InstallationTokenProvider(async () => "test-only-private-key",
    async () => { throw new AppTokenError("APP_JWT_SIGNING_FAILED"); }, () => at);
  await expectCode(typed.forApp(identity), "APP_JWT_SIGNING_FAILED");
});

test("empty and expiring installation tokens are rejected without exposing them", async () => {
  for (const token of ["", "invalid-but-not-exposed"]) {
    const provider = new InstallationTokenProvider(async () => "test-only-private-key",
      async () => ({
        token, expiresAt: new Date(at + (token ? 30_000 : 3_600_000)).toISOString(),
      }), () => at);
    await expectCode(provider.forApp(identity), "APP_TOKEN_INVALID");
  }
});

test("valid installation token caches until renewal window and does not request a second token", async () => {
  let issued = 0;
  const provider = new InstallationTokenProvider(async () => "test-only-private-key",
    async () => {
      issued += 1;
      return { token: "opaque-test-token", expiresAt: new Date(at + 3_600_000).toISOString() };
    }, () => at);
  assert.equal(await provider.forApp(identity), "opaque-test-token");
  assert.equal(await provider.forApp(identity), "opaque-test-token");
  assert.equal(issued, 1);
});
