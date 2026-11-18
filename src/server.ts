import { McpServer } from "@modelcontextprotocol/server";
import { conversationMetadata } from "./request-context.ts";
import { registerGitHubReadTools } from "./github-mcp.ts";
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

export function createIdentityMcpServer(router: IdentityRouter, github?: GitHubOperations, trustedTenantId?: string): McpServer {
  // Production uses a verified tenant captured by the authenticated HTTP boundary.
  // Local development can still use the earlier metadata-only POC contract.
  const tenantFor = (extra: unknown) => trustedTenantId ?? verifiedTenantFromContext(extra);
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
        const state = await router.identify(conversationMetadata(extra), tenantFor(extra));
        return result({ ok: true, ...state, ...(!state.registered ? { availableIdentities: router.list() } : {}) });
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
        return result({ ok: true, ...(await router.bind(conversationMetadata(extra), identityId, tenantFor(extra))) });
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
        return result({ ok: true, ...(await router.identify(conversationMetadata(extra), tenantFor(extra))) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // Operators need this opaque, signed-principal-derived tenant ID to
  // register GitHub Apps in D1 without storing raw JWTs or personal emails.
  if (trustedTenantId) {
    server.registerTool(
      "get_my_tenant_id",
      {
        title: "Get my authenticated tenant ID",
        description: "Return the verified tenant identifier for private GitHub App onboarding.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      async () => result({ ok: true, tenantId: trustedTenantId }),
    );
  }

  if (github && trustedTenantId) registerGitHubReadTools(server, github, trustedTenantId);
  return server;
}
