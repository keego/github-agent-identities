import { McpServer } from "@modelcontextprotocol/server";
import { conversationMetadata } from "./request-context.ts";
import { registerGitHubTools } from "./github-mcp.ts";
import { verifiedTenantFromContext } from "./verified-tenant.ts";
import type { GitHubOperations } from "./github-operations.ts";
import * as z from "zod/v4";
import {
  IdentityRouter,
  IdentityError,
  type ClientMetadata,
} from "./core.ts";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
  if (error instanceof IdentityError) {
    return { ...result({ ok: false, error: error.code }), isError: true };
  }
  // Unexpected internal failures should not leak user identifiers or secrets.
  return { ...result({ ok: false, error: "INTERNAL_ERROR" }), isError: true };
}

export function createIdentityMcpServer(router: IdentityRouter, github?: GitHubOperations): McpServer {
  const server = new McpServer({
    name: "github-agent-identities",
    version: "0.1.0",
  });

  server.registerTool(
    "identify_chat",
    {
      title: "Identify this conversation",
      description: "Show this ChatGPT conversation's anonymized fingerprint and current agent identity, if bound.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) => {
      try {
        return result({ ok: true, ...(await router.identify(conversationMetadata(extra), verifiedTenantFromContext(extra))) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_identities",
    {
      title: "Available agent identities",
      description: "List the friendly identities this server is configured to offer.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => result({ ok: true, identities: router.list() }),
  );

  server.registerTool(
    "bind_identity",
    {
      title: "Assign this conversation's agent identity",
      description: "Assign a selected identity to the current conversation. This operation replaces any prior binding.",
      inputSchema: z.object({ identityId: z.string().min(1) }),
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ identityId }, extra) => {
      try {
        return result({ ok: true, ...(await router.bind(conversationMetadata(extra), identityId, verifiedTenantFromContext(extra))) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_current_identity",
    {
      title: "Get this conversation's selected identity",
      description: "Return the identity bound to the calling conversation, or report that it is unregistered.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) => {
      try {
        return result({ ok: true, ...(await router.identify(conversationMetadata(extra), verifiedTenantFromContext(extra))) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  if (github) registerGitHubTools(server, github);
  return server;
}
