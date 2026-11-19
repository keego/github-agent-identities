import { createAppAuth } from "@octokit/auth-app";
import type { AppIdentity } from "./github-apps.ts";

export type SecretReader = (secretRef: string) => Promise<string | null>;

/** Safe operational stages only; never include private keys, tokens or remote response bodies. */
export type AppTokenErrorCode =
  | "APP_SECRET_REF_INVALID"
  | "APP_SECRET_UNAVAILABLE"
  | "APP_JWT_SIGNING_FAILED"
  | "APP_INSTALLATION_TOKEN_FAILED"
  | "APP_TOKEN_INVALID";

export class AppTokenError extends Error {
  constructor(public readonly code: AppTokenErrorCode) {
    super(code);
  }
}

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
  let auth: ReturnType<typeof createAppAuth>;
  try {
    auth = createAppAuth({ appId, privateKey });
    // Sign an App JWT locally first. Never return or log this JWT.
    // This isolates key/crypto problems from GitHub installation-token exchange failures.
    await auth({ type: "app" });
  } catch {
    throw new AppTokenError("APP_JWT_SIGNING_FAILED");
  }
  try {
    const result = await auth({ type: "installation", installationId });
    return { token: result.token, expiresAt: result.expiresAt };
  } catch {
    throw new AppTokenError("APP_INSTALLATION_TOKEN_FAILED");
  }
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
      throw new AppTokenError("APP_SECRET_REF_INVALID");
    }
    let privateKey: string | null;
    try {
      privateKey = await this.readSecret(identity.secretRef);
    } catch {
      throw new AppTokenError("APP_SECRET_UNAVAILABLE");
    }
    if (!privateKey) throw new AppTokenError("APP_SECRET_UNAVAILABLE");

    // Never expose the private key or token in thrown errors or logs.
    let issued: InstallationToken;
    try {
      issued = await this.issuer({
        appId: identity.appId,
        installationId: identity.installationId,
        privateKey,
      });
    } catch (error) {
      if (error instanceof AppTokenError) throw error;
      throw new AppTokenError("APP_INSTALLATION_TOKEN_FAILED");
    }
    const expiresAt = Date.parse(issued.expiresAt);
    if (!issued.token || !Number.isFinite(expiresAt) || expiresAt <= this.now() + 60_000) {
      throw new AppTokenError("APP_TOKEN_INVALID");
    }
    this.cached.set(cacheKey, { token: issued.token, expiresAt });
    return issued.token;
  }

  clear(): void {
    this.cached.clear();
  }
}
