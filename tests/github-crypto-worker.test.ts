import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { Miniflare } from "miniflare";

test("Cloudflare Worker crypto runtime converts synthetic GitHub PKCS#1 and signs with WebCrypto", async () => {
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const workerSource = `
    import { createPrivateKey } from "node:crypto";
    export default {
      async fetch(_request, env) {
        const normalized = createPrivateKey(env.SYNTHETIC_KEY).export({ format: "pem", type: "pkcs8" }).toString();
        const keyBytes = Uint8Array.from(atob(normalized.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\s/g, "")), c => c.charCodeAt(0));
        const key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
        const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode("synthetic-runtime-probe"));
        return Response.json({ pkcs8: normalized.startsWith("-----BEGIN PRIVATE KEY-----"), signatureBytes: signature.byteLength });
      },
    };
  `;
  const mf = new Miniflare({
    modules: true, script: workerSource, compatibilityDate: "2026-08-06",
    compatibilityFlags: ["nodejs_compat"], bindings: { SYNTHETIC_KEY: pkcs1 },
  });
  try {
    const response = await mf.dispatchFetch("http://localhost/");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { pkcs8: true, signatureBytes: 256 });
  } finally {
    await mf.dispose();
  }
});
