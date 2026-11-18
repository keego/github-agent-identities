import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  GitHubOperations,
  GithubOperationError,
  type VerifiedCaller,
} from "./github-operations.ts";

function callerFromExtra(extra: unknown): VerifiedCaller | null {
  if (!extra || typeof extra !== "object") return null;
  const ctx = extra as {
    _meta?: Record<string, unknown>;
    http?: { authInfo?: { clientId?: string } };
  };
  // Only verified authInfo injected by HTTP authentication middleware
  // may define the tenant. Never accept tenant as a model tool argument.
  const tenantId = ctx.http?.authInfo?.clientId;
  if (!tenantId || !ctx._meta) return null;
  return { tenantId, metadata: ctx._meta };
}

function output(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function invoke<T>(extra: unknown, work: (caller: VerifiedCaller) => Promise<T>) {
  const caller = callerFromExtra(extra);
  if (!caller) return output({ ok: false, error: "NOT_AUTHENTICATED" }, true);
  try {
    return output({ ok: true, result: await work(caller) });
  } catch (error) {
    const code = error instanceof GithubOperationError ? error.code : "INTERNAL_ERROR";
    return output({ ok: false, error: code }, true);
  }
}

export function registerGitHubTools(server: McpServer, operations: GitHubOperations) {
  server.registerTool(
    "github_get_pull_request",
    {
      title: "Get a pull request",
      description: "Read a pull request through the App bound to this authenticated conversation.",
      inputSchema: z.object({ repository: z.string(), number: z.number().int().positive() }),
      annotations: { readOnlyHint: true },
    },
    async ({ repository, number }, extra) =>
      invoke(extra, caller => operations.getPullRequest(caller, repository, number)),
  );

  server.registerTool(
    "github_comment_on_pr",
    {
      title: "Comment on a pull request as the bound GitHub App",
      description: "Post a visible PR comment using the current chat's bound GitHub App. Requires approval before sending.",
      inputSchema: z.object({ repository: z.string(), number: z.number().int().positive(), comment: z.string().min(1).max(60000) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ repository, number, comment }, extra) =>
      invoke(extra, caller => operations.commentOnPullRequest(caller, repository, number, comment)),
  );
}
