/**
 * Cloudflare Workers MCP skeleton.
 *
 * SAFE DEFAULT: returns 503 until the operator deliberately enables a
 * credential-free, identity-only demo. GitHub App tools are NOT registered.
 * This is not a production authenticated deployment.
 */
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { D1BindingStore, type SqlDatabase } from "./d1-store.ts";
import { IdentityRouter, exampleIdentities } from "./core.ts";
import { createIdentityMcpServer } from "./server.ts";

export type WorkerEnv = {
  DB: SqlDatabase;
  MCP_PUBLIC_HOSTNAME: string;
  ENABLE_UNAUTHENTICATED_DEMO?: string;
};

async function handle(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method === "GET" && new URL(request.url).pathname === "/health") {
    return new Response("healthy", { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  // Deploying the Worker is not equivalent to granting access.
  // Unauthenticated demo mode is strictly an opt-in, GitHub-free pilot.
  if (env.ENABLE_UNAUTHENTICATED_DEMO !== "true") {
    return new Response("MCP service not configured for authenticated access", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!env.DB || !env.MCP_PUBLIC_HOSTNAME) {
    return new Response("MCP demo configuration missing", { status: 503 });
  }
  const hostRejected = hostHeaderValidationResponse(request, [env.MCP_PUBLIC_HOSTNAME]);
  if (hostRejected) return hostRejected;
  const originRejected = originValidationResponse(request, ["chatgpt.com", env.MCP_PUBLIC_HOSTNAME]);
  if (originRejected) return originRejected;

  if (new URL(request.url).pathname !== "/mcp") return new Response("Not found", { status: 404 });

  const router = new IdentityRouter(new D1BindingStore(env.DB), exampleIdentities);
  const handler = createMcpHandler(() => createIdentityMcpServer(router), {
    responseMode: "json",
  });
  return handler.fetch(request);
}

export default { fetch: handle };
