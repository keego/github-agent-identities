import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorizedPilotScope, PILOT_COMMENT_TEXT, PILOT_COMMENT_CONFIRMATION,
} from "../src/comment-pilot.ts";

const base = {
  GH_APP_READONLY_ENABLED: "true",
  GH_APP_COMMENT_PILOT_ENABLED: "true",
  GH_APP_COMMENT_PILOT_OWNER_TENANT_ID: "cloudflare-access:owner",
  GH_APP_COMMENT_PILOT_REPOSITORY: "keego/poster-brain",
  GH_APP_COMMENT_PILOT_NUMBER: "22",
};

test("write scope is valid only for the signed owner with exactly one invited user", () => {
  assert.deepEqual(authorizedPilotScope(base, "cloudflare-access:owner", 1), {
    ownerTenantId: "cloudflare-access:owner",
    repository: "keego/poster-brain",
    number: 22,
  });
  for (const [env, principal, invited] of [
    [{ ...base, GH_APP_READONLY_ENABLED: "false" }, "cloudflare-access:owner", 1],
    [{ ...base, GH_APP_COMMENT_PILOT_ENABLED: "false" }, "cloudflare-access:owner", 1],
    [base, "cloudflare-access:other", 1],
    [base, "cloudflare-access:owner", 2],
    [base, "cloudflare-access:owner", 0],
    [{ ...base, GH_APP_COMMENT_PILOT_NUMBER: "2e3" }, "cloudflare-access:owner", 1],
    [{ ...base, GH_APP_COMMENT_PILOT_NUMBER: "0" }, "cloudflare-access:owner", 1],
    [{ ...base, GH_APP_COMMENT_PILOT_REPOSITORY: "keego/../other" }, "cloudflare-access:owner", 1],
    [{ ...base, GH_APP_COMMENT_PILOT_OWNER_TENANT_ID: "" }, "cloudflare-access:owner", 1],
  ] as const) {
    assert.equal(authorizedPilotScope(env, principal, invited), null);
  }
  assert.equal(PILOT_COMMENT_CONFIRMATION, "POST_APPROVED_PILOT_COMMENT");
  assert.ok(PILOT_COMMENT_TEXT.includes("No action required."));
  assert.ok(PILOT_COMMENT_TEXT.length < 400);
});
