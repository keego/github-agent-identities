import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, webcrypto } from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { AppTokenError, InstallationTokenProvider, octokitTokenIssuer, prepareAppPrivateKey } from "../src/github-auth.ts";
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
  }), "APP_KEY_FORMAT_INVALID");
});

test("Octokit signs a synthetic PKCS#1 GitHub-style key without contacting GitHub", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const syntheticPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
  const auth = createAppAuth({ appId: identity.appId, privateKey: syntheticPem });
  const result = await auth({ type: "app" });
  assert.equal(result.token.split(".").length, 3); // Only check shape; never print JWT in failures.
  assert.equal(result.appId, identity.appId);
});

test("GitHub PKCS#1 key converts into WebCrypto-importable PKCS#8 without changing its signing identity", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const original = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const converted = prepareAppPrivateKey(original);
  assert.equal(converted.startsWith("-----BEGIN PRIVATE KEY-----"), true);
  assert.equal(converted.includes("RSA PRIVATE KEY"), false);
  const encoded = converted.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\s/g, "");
  const signingKey = await webcrypto.subtle.importKey("pkcs8", Buffer.from(encoded, "base64"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const data = Buffer.from("synthetic-github-app-test");
  const signature = Buffer.from(await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, data));
  const verificationKey = publicKey.export({ type: "spki", format: "pem" }).toString();
  const { verify } = await import("node:crypto");
  assert.equal(verify("sha256", data, verificationKey, signature), true);
});

test("PKCS#8 and escaped-newline PKCS#1 keys normalize; malformed or non-RSA keys fail closed", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.equal(prepareAppPrivateKey(pkcs8).startsWith("-----BEGIN PRIVATE KEY-----"), true);
  assert.equal(prepareAppPrivateKey(pkcs1.trim().replace(/\\n/g, "\\\\n")).startsWith("-----BEGIN PRIVATE KEY-----"), true);
  assert.equal(prepareAppPrivateKey(pkcs1.replace(/\\n/g, "\\r\\n")).startsWith("-----BEGIN PRIVATE KEY-----"), true);
  await expectCode(Promise.resolve().then(() => prepareAppPrivateKey("not-a-private-key")), "APP_KEY_FORMAT_INVALID");
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  await expectCode(Promise.resolve().then(() => prepareAppPrivateKey(ec)), "APP_KEY_FORMAT_INVALID");
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
