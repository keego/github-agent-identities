import type { ClientMetadata } from "./core.ts";

/**
 * MCP SDK v2 exposes tool-request metadata at ctx.mcpReq._meta.
 * Legacy v1 context metadata lived at the flat ctx._meta.
 */
export function conversationMetadata(ctx: unknown): ClientMetadata {
  if (!ctx || typeof ctx !== "object" || !("mcpReq" in ctx)) return undefined;
  const req = (ctx as { mcpReq?: { _meta?: unknown } }).mcpReq;
  const meta = req?._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  return meta as Record<string, unknown>;
}
