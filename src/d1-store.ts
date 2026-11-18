import type { BindingStore } from "./core.ts";

/**
 * Minimal D1 structural interfaces. Keeping these local avoids importing
 * Cloudflare Worker types into domain logic or non-Cloudflare deployment targets.
 */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
}

/** Production-capable durable adapter for Cloudflare D1. */
export class D1BindingStore implements BindingStore {
  constructor(private readonly db: SqlDatabase) {}

  async read(key: string): Promise<string | null> {
    const row = await this.db.prepare(
      "SELECT identity_id FROM conversation_bindings WHERE binding_key = ?1"
    ).bind(key).first<{ identity_id: string }>();
    return row?.identity_id ?? null;
  }

  async write(key: string, identityId: string): Promise<void> {
    await this.db.prepare(
      "INSERT INTO conversation_bindings (binding_key, identity_id, updated_at) " +
      "VALUES (?1, ?2, unixepoch()) " +
      "ON CONFLICT(binding_key) DO UPDATE SET " +
      "identity_id = excluded.identity_id, updated_at = unixepoch()"
    ).bind(key, identityId).run();
  }
}
