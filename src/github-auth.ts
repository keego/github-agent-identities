import { createAppAuth } from "@octokit/auth-app";
import type { AppIdentity } from "./github-apps.ts";

export type SecretReader = (secretRef: string) => Promise<string | null>;

export type InstallationToken = {
  token: string;
  expiresAt: string;
};

export type TokenIssuer = (params: {
  appId: number;
  installationId: number;
  privateKey: string;
}) => Promise<InstallationToken>;

/**
 * Octokit handles GitHub's PKCS#1 App private keys, RS256 JWT signing
 * and the exchange to a short-lived GitHub installation token.
 */
export const octokitTokenIssuer: TokenIssuer = async ({ appId, installationId, privateKey }) => {
  const auth = createAppAuth({ appId, privateKey });
  const result = await auth({ type: "installation", installationId });
  return { token: result.token, expiresAt: result.expiresAt };
};

/** Only the trusted backend calls this. Tokens are NEVER put in MCP tool output. */
export class InstallationTokenProvider {
  private readonly cached = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly readSecret: SecretReader,
    private readonly issuer: TokenIssuer = octokitTokenIssuer,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async forApp(identity: AppIdentity): Promise<string> {
    const cacheKey = [identity.appId, identity.installationId, identity.secretRef].join(":");
    const cached = this.cached.get(cacheKey);
    if (cached && cached.expiresAt > this.now() + 60_000) {
      return cached.token;
    }

    if (!/^GH_APP_[A-Z0-9_]+_PRIVATE_KEY$/.test(identity.secretRef)) {
      throw new Error("Invalid secret reference");
    }
    const privateKey = await this.readSecret(identity.secretRef);
    if (!privateKey) throw new Error("GitHub App private key not configured");

    // Never expose the private key or token in thrown errors or logs.
    let issued: InstallationToken;
    try {
      issued = await this.issuer({
        appId: identity.appId,
        installationId: identity.installationId,
        privateKey,
      });
    } catch {
      throw new Error("Failed to authenticate GitHub App installation");
    }
    const expiresAt = Date.parse(issued.expiresAt);
    if (!issued.token || !Number.isFinite(expiresAt) || expiresAt <= this.now() + 60_000) {
      throw new Error("GitHub App token response is invalid or expiring");
    }
    this.cached.set(cacheKey, { token: issued.token, expiresAt });
    return issued.token;
  }

  clear(): void {
    this.cached.clear();
  }
}
