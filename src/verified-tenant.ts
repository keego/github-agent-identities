/**
 * Resolve tenant identity ONLY from a trusted server-side token verifier.
 *
 * OAuth clientId identifies the OAuth application, not the human who logged in.
 * The verifier MUST populate authInfo.extra.tenantId based on validated
 * user/organization claims. MCP _meta values are untrusted for authentication.
 */
export function verifiedTenantFromContext(ctx: unknown): string | undefined {
  if (!ctx || typeof ctx !== "object" || !("http" in ctx)) return undefined;
  const http = (ctx as {
    http?: { authInfo?: { extra?: Record<string, unknown> } };
  }).http;
  const tenantId = http?.authInfo?.extra?.tenantId;
  return typeof tenantId === "string" && tenantId.trim() !== "" ? tenantId : undefined;
}
