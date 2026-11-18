/**
 * Domain logic is independent of GitHub, MCP transports and persistence.
 * Session metadata correlates calls; it is NOT an authentication credential.
 */
export type AgentIdentity = Readonly<{
  id: string;
  displayName: string;
}>;

export type ClientMetadata = Record<string, unknown> | undefined;

export interface BindingStore {
  read(key: string): Promise<string | null>;
  write(key: string, identityId: string): Promise<void>;
}

export class MemoryBindingStore implements BindingStore {
  private readonly bindings = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.bindings.get(key) ?? null;
  }

  async write(key: string, identityId: string): Promise<void> {
    this.bindings.set(key, identityId);
  }
}

export type ChatIdentity = Readonly<{
  key: string;
  fingerprint: string;
}>;

export class IdentityError extends Error {
  constructor(public readonly code: "CHAT_METADATA_MISSING" | "IDENTITY_NOT_FOUND") {
    super(code);
  }
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function getChatIdentity(meta: ClientMetadata, tenantId = "unverified"): Promise<ChatIdentity> {
  const session = meta?.["openai/session"];
  const subject = meta?.["openai/subject"];

  // Do not alias missing users or sessions to a global "unknown" bucket.
  if (!isNonemptyString(session) || !isNonemptyString(subject)) {
    throw new IdentityError("CHAT_METADATA_MISSING");
  }

  // Domain-separate the two fields. Only a pseudonymous digest is persisted.
  const material = JSON.stringify(["github-agent-identities/v2", tenantId, subject, session]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  const key = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
  return { key, fingerprint: key.slice(0, 12) };
}

export class IdentityRouter {
  private readonly identities = new Map<string, AgentIdentity>();

  constructor(
    private readonly store: BindingStore,
    identities: readonly AgentIdentity[],
  ) {
    for (const identity of identities) {
      if (!identity.id || this.identities.has(identity.id)) {
        throw new Error("Identity IDs must be nonempty and unique");
      }
      this.identities.set(identity.id, Object.freeze({ ...identity }));
    }
  }

  list(): AgentIdentity[] {
    return [...this.identities.values()];
  }

  async identify(meta: ClientMetadata, tenantId?: string) {
    const { key, fingerprint } = await getChatIdentity(meta, tenantId);
    const identityId = await this.store.read(key);
    const identity = identityId ? this.identities.get(identityId) ?? null : null;
    return {
      registered: identity !== null,
      fingerprint,
      identity,
    };
  }

  async bind(meta: ClientMetadata, identityId: string, tenantId?: string) {
    const identity = this.identities.get(identityId);
    if (!identity) throw new IdentityError("IDENTITY_NOT_FOUND");
    const { key, fingerprint } = await getChatIdentity(meta);
    await this.store.write(key, identity.id);
    return { registered: true, fingerprint, identity };
  }
}

export const exampleIdentities: readonly AgentIdentity[] = [
  { id: "design", displayName: "UI/UX Designer" },
  { id: "qa", displayName: "QA Engineer" },
  { id: "dev", displayName: "Developer" },
];
