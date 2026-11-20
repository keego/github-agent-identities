/** One owner, one target PR, one attempt. MCP metadata is never trusted for tenancy. */
import type { SqlDatabase } from "./d1-store.ts";

export const PILOT_COMMENT_TEXT =
  "GitHub Agent Identities staging smoke test: this comment was posted by the GitHub App identity bound to an authenticated ChatGPT conversation. No action required.";
export const PILOT_COMMENT_CONFIRMATION = "POST_APPROVED_PILOT_COMMENT";

export type CommentPilotScope = Readonly<{
  ownerTenantId: string;
  repository: string;
  number: number;
}>;
export type PilotCommentEnvironment = Readonly<{
  GH_APP_READONLY_ENABLED?: string;
  GH_APP_COMMENT_PILOT_ENABLED?: string;
  GH_APP_COMMENT_PILOT_OWNER_TENANT_ID?: string;
  GH_APP_COMMENT_PILOT_REPOSITORY?: string;
  GH_APP_COMMENT_PILOT_NUMBER?: string;
}>;

/** No owner, multiple invited users, malformed target or missing flag => no tool. */
export function authorizedPilotScope(
  env: PilotCommentEnvironment, verifiedTenantId: string, invitedUserCount: number,
): CommentPilotScope | null {
  if (env.GH_APP_READONLY_ENABLED !== "true" ||
      env.GH_APP_COMMENT_PILOT_ENABLED !== "true" || invitedUserCount !== 1 ||
      !verifiedTenantId || env.GH_APP_COMMENT_PILOT_OWNER_TENANT_ID !== verifiedTenantId ||
      !verifiedTenantId.startsWith("cloudflare-access:")) return null;
  const repository = env.GH_APP_COMMENT_PILOT_REPOSITORY?.trim();
  const numberString = env.GH_APP_COMMENT_PILOT_NUMBER?.trim();
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      repository.includes("..") || !numberString || !/^[1-9][0-9]*$/.test(numberString)) return null;
  const number = Number(numberString);
  if (!Number.isSafeInteger(number)) return null;
  return { ownerTenantId: verifiedTenantId, repository: repository.toLowerCase(), number };
}

export interface PilotCommentClaims {
  /** Atomic attempt claim: false means another request has already claimed it. */
  claim(tenantId: string, repository: string, number: number, identityId: string): Promise<boolean>;
  /** Best-effort record of posted comment. Never release a claimed attempt. */
  complete(tenantId: string, repository: string, number: number,
    id: number, url: string, author: string | null): Promise<void>;
}

/** An attempt is recorded BEFORE a GitHub POST. Unknown outcome is never auto-retried. */
export class D1PilotCommentClaims implements PilotCommentClaims {
  constructor(private readonly db: SqlDatabase) {}
  async claim(tenantId: string, repository: string, number: number, identityId: string): Promise<boolean> {
    const result = await this.db.prepare(
      "INSERT OR IGNORE INTO pilot_comment_attempts (tenant_id, repository, pr_number, identity_id) " +
      "VALUES (?1, ?2, ?3, ?4)"
    ).bind(tenantId, repository, number, identityId).run() as { meta?: { changes?: number } };
    if (result?.meta?.changes === 1) return true;
    if (result?.meta?.changes === 0) return false;
    throw new Error("Pilot claim status unknown");
  }
  async complete(tenantId: string, repository: string, number: number,
    id: number, url: string, author: string | null): Promise<void> {
    await this.db.prepare(
      "UPDATE pilot_comment_attempts SET state = 'posted', github_comment_id = ?4, " +
      "github_comment_url = ?5, github_author = ?6, updated_at = unixepoch() " +
      "WHERE tenant_id = ?1 AND repository = ?2 AND pr_number = ?3 AND state = 'attempted'"
    ).bind(tenantId, repository, number, id, url, author).run();
  }
}
