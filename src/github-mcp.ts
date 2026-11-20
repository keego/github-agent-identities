import { McpServer } from "@modelcontextprotocol/server";
import { conversationMetadata } from "./request-context.ts";
import * as z from "zod/v4";
import { PILOT_COMMENT_TEXT, PILOT_COMMENT_CONFIRMATION } from "./comment-pilot.ts";
import {
  GitHubOperations,
  GithubOperationError,
  type VerifiedCaller,
} from "./github-operations.ts";

/**
 * A verified human tenant MUST be supplied by the hosting auth boundary.
 * Tool parameters, request metadata and OAuth clientId never define a user.
 */
function callerFromExtra(extra: unknown, verifiedTenantId: string): VerifiedCaller | null {
  const metadata = conversationMetadata(extra);
  if (!verifiedTenantId || !metadata) return null;
  return { tenantId: verifiedTenantId, metadata };
}

function output(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function invoke<T>(
  extra: unknown,
  verifiedTenantId: string,
  work: (caller: VerifiedCaller) => Promise<T>,
) {
  const caller = callerFromExtra(extra, verifiedTenantId);
  if (!caller) return output({ ok: false, error: "NOT_AUTHENTICATED" }, true);
  try {
    return output({ ok: true, result: await work(caller) });
  } catch (error) {
    if (error instanceof GithubOperationError) {
      return output({
        ok: false, error: error.code,
        ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
      }, true);
    }
    return output({ ok: false, error: "INTERNAL_ERROR" }, true);
  }
}

/**
 * Reads from #17, plus only the #5 explicitly configured one-owner pilot
 * comment tool. No general comment or repository write tools are exposed.
 */
export function registerGitHubReadTools(
  server: McpServer,
  operations: GitHubOperations,
  verifiedTenantId: string,
  pilotCommentEnabled = false,
): void {
  if (!verifiedTenantId) throw new Error("Verified tenant required for GitHub tools");
  server.registerTool(
    "github_get_pull_request",
    {
      title: "Get a pull request as the bound GitHub App",
      description: "Read a PR through the App bound to this authenticated conversation.",
      inputSchema: z.object({ repository: z.string(), number: z.number().int().positive() }),
      annotations: { readOnlyHint: true },
    },
    async ({ repository, number }, extra) =>
      invoke(extra, verifiedTenantId, caller =>
        operations.getPullRequest(caller, repository, number)),
  );
  if (pilotCommentEnabled) {
    server.registerTool(
      "github_post_pilot_comment",
      {
        title: "Post one approved staging GitHub App comment",
        description: "External GitHub write to the one operator-configured test PR. " +
          "Do NOT invoke until the human explicitly approves this exact target and text: " +
          PILOT_COMMENT_TEXT + " No arbitrary comments or automatic retries.",
        inputSchema: z.object({
          repository: z.string(),
          number: z.number().int().positive(),
          confirmation: z.literal(PILOT_COMMENT_CONFIRMATION),
        }),
        annotations: {
          readOnlyHint: false, destructiveHint: true,
          idempotentHint: false, openWorldHint: true,
        },
      },
      async ({ repository, number, confirmation }, extra) =>
        invoke(extra, verifiedTenantId, caller =>
          operations.commentOnPilotPullRequest(caller, repository, number, confirmation)),
    );
  }
}
