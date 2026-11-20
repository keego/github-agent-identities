/**
 * Private, Cloudflare Access-protected MCP endpoint.
 *
 * Cloudflare Access Managed OAuth supplies sign-in/consent/refresh at the
 * edge. This Worker independently verifies every signed identity assertion
 * and an explicit operator allowlist before even constructing MCP tools.
 *
 * Read-only App tools are proven. The #5 comment pilot is gated by separate,
 * default-off, one-owner/one-target settings and a D1 one-attempt claim.
 */
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { type JWTVerifyGetKey } from "jose";
import { D1BindingStore, type SqlDatabase } from "./d1-store.ts";
import { D1AppRegistry } from "./github-apps.ts";
import { createTenantRouter } from "./tenant-router.ts";
import { InstallationTokenProvider } from "./github-auth.ts";
import { GitHubOperations } from "./github-operations.ts";
import { authorizedPilotScope, D1PilotCommentClaims } from "./comment-pilot.ts";
import { createIdentityMcpServer } from "./server.ts";
import { accessSettings, authenticateAccess } from "./access-auth.ts";

type RegistryDatabase = ConstructorParameters<typeof D1AppRegistry>[0];
export type WorkerEnv = {
  DB: SqlDatabase & RegistryDatabase;
  MCP_PUBLIC_HOSTNAME: string;
  ACCESS_ISSUER?: string;
  ACCESS_AUDIENCE?: string;
  ALLOWED_ACCESS_EMAILS?: string;
  /** Opt-in read-only GitHub App tools; false by default. */
  GH_APP_READONLY_ENABLED?: string;
  GH_APP_COMMENT_PILOT_ENABLED?: string;
  GH_APP_COMMENT_PILOT_OWNER_TENANT_ID?: string;
  GH_APP_COMMENT_PILOT_REPOSITORY?: string;
  GH_APP_COMMENT_PILOT_NUMBER?: string;
  /** Cloudflare secret bindings selected by operator-owned D1 registry. */
  [secretBindingName: string]: unknown;
  /** Deprecated POC switch: intentionally ignored in the private Worker. */
  ENABLE_UNAUTHENTICATED_DEMO?: string;
};

const denied = (status: number, error: string): Response =>
  Response.json({ ok: false, error }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

/** keyResolver is test-only; production always uses Cloudflare's JWKS. */
export async function handlePrivateWorker(
  request: Request,
  env: WorkerEnv,
  keyResolver?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return new Response("healthy", {
      status: 200, headers: { "Cache-Control": "no-store" },
    });
  }

  if (!env.DB || !env.MCP_PUBLIC_HOSTNAME) return denied(503, "NOT_CONFIGURED");
  const hostRejected = hostHeaderValidationResponse(request, [env.MCP_PUBLIC_HOSTNAME]);
  if (hostRejected) return hostRejected;
  const originRejected = originValidationResponse(request, ["chatgpt.com", env.MCP_PUBLIC_HOSTNAME]);
  if (originRejected) return originRejected;

  if (url.pathname !== "/mcp") return denied(404, "NOT_FOUND");

  const settings = accessSettings(env);
  if (!settings) return denied(503, "AUTH_NOT_CONFIGURED");

  const auth = await authenticateAccess(request, settings, keyResolver);
  if (!auth.ok) return denied(auth.status, auth.code);

  // This is the ONLY source of the production tenant. Request metadata,
  // tool arguments, OAuth clientId and untrusted headers have no authority.
  const tenantId = auth.principal.tenantId;
  let router;
  try {
    router = await createTenantRouter(
      new D1BindingStore(env.DB),
      new D1AppRegistry(env.DB),
      tenantId,
    );
  } catch {
    // Schema errors and DB availability problems must not leak internals.
    return denied(503, "STORAGE_UNAVAILABLE");
  }
  // Any comment pilot also requires a verified owner, exactly one invited
  // human, an explicit read flag, and a single configured target PR.
  const pilotScope = authorizedPilotScope(env, tenantId, settings.allowedEmails.size);
  const registry = new D1AppRegistry(env.DB);
  const readOnlyGitHub = env.GH_APP_READONLY_ENABLED === "true"
    ? new GitHubOperations(
      router,
      registry,
      new InstallationTokenProvider(async reference => {
        if (!/^GH_APP_[A-Z0-9_]+_PRIVATE_KEY$/.test(reference)) return null;
        const secret = env[reference];
        return typeof secret === "string" && secret.length > 0 ? secret : null;
      }),
      undefined,
      pilotScope ? { ...pilotScope, claims: new D1PilotCommentClaims(env.DB) } : undefined,
    )
    : undefined;
  const handler = createMcpHandler(
    () => createIdentityMcpServer(router, readOnlyGitHub, tenantId, pilotScope !== null),
    { responseMode: "json" },
  );
  return handler.fetch(request);
}

export default {
  fetch(request: Request, env: WorkerEnv) {
    return handlePrivateWorker(request, env);
  },
};
