import { McpServer } from "@modelcontextprotocol/server";
import { conversationMetadata } from "./request-context.ts";
import * as z from "zod/v4";
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
    const code = error instanceof GithubOperationError ? error.code : "INTERNAL_ERROR";
    return output({ ok: false, error: code }, true);
  }
}

/**
 * Read tools only. GitHub writes are intentionally NOT registered in #17.
 * #5 will add an explicit independently reviewed approval/write gate.
 */
export function registerGitHubReadTools(
  server: McpServer,
  operations: GitHubOperations,
  verifiedTenantId: string,
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
}
