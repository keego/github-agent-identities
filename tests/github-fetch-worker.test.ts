import assert from "node:assert/strict";
import { test } from "node:test";
import { Miniflare, createFetchMock } from "miniflare";

test("Workerd rejects unbound native fetch on a class but accepts a wrapper", async () => {
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();

  // The original failure must not consume this mocked response; only the
  // corrected invocation can make the outgoing request.
  fetchMock.get("https://api.github.com")
    .intercept({ method: "GET", path: "/repos/keego/poster-brain/pulls/22" })
    .reply(200, JSON.stringify({ number: 22, title: "Synthetic PR" }),
      { headers: { "content-type": "application/json" } });

  const workerSource = `
    const target = "https://api.github.com/repos/keego/poster-brain/pulls/22";
    class UnsafeNativeFetch {
      constructor() { this.httpFetch = fetch; }
      async get() { return this.httpFetch(target, { method: "GET" }); }
    }
    class SafeNativeFetch {
      constructor() { this.httpFetch = (input, init) => fetch(input, init); }
      async get() { return this.httpFetch(target, { method: "GET" }); }
    }
    export default {
      async fetch() {
        let unsafeError;
        try {
          await new UnsafeNativeFetch().get();
          unsafeError = "NONE";
        } catch (error) {
          // Never return raw exception messages from production.
          unsafeError = error?.name ?? "UNKNOWN";
        }
        const response = await new SafeNativeFetch().get();
        const data = await response.json();
        return Response.json({
          unsafeError,
          safeStatus: response.status,
          number: data.number,
        });
      },
    };
  `;
  const mf = new Miniflare({
    modules: true,
    script: workerSource,
    compatibilityDate: "2026-08-06",
    compatibilityFlags: ["nodejs_compat"],
    fetchMock,
  });
  try {
    const response = await mf.dispatchFetch("http://localhost/");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      unsafeError: "TypeError",
      safeStatus: 200,
      number: 22,
    });
    fetchMock.assertNoPendingInterceptors();
  } finally {
    await mf.dispose();
  }
});
