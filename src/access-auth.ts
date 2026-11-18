/**
 * Authenticate a human user through Cloudflare Access Managed OAuth.
 * Access handles external OAuth, while this Worker independently verifies
 * its signed assertion. Session identifiers and client IDs are not users.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export type AccessSettings = Readonly<{
  issuer: string;
  audience: string;
  allowedEmails: ReadonlySet<string>;
}>;
export type AccessPrincipal = Readonly<{ tenantId: string; email: string }>;
export type AccessDecision =
  | { ok: true; principal: AccessPrincipal }
  | { ok: false; status: 401 | 403; code: "UNAUTHENTICATED" | "NOT_ALLOWED" };

const jwksCache = new Map<string, JWTVerifyGetKey>();
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Fail closed until all three operator-provided auth settings are configured. */
export function accessSettings(env: {
  ACCESS_ISSUER?: string;
  ACCESS_AUDIENCE?: string;
  ALLOWED_ACCESS_EMAILS?: string;
}): AccessSettings | null {
  if (!isText(env.ACCESS_ISSUER) || !isText(env.ACCESS_AUDIENCE) || !isText(env.ALLOWED_ACCESS_EMAILS)) {
    return null;
  }
  let url: URL;
  try { url = new URL(env.ACCESS_ISSUER); } catch { return null; }

  // Never fetch remote keys from arbitrary caller-controlled hostnames.
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(url.hostname) ||
    url.pathname !== "/" || url.search !== "" || url.hash !== "" ||
    url.username !== "" || url.password !== ""
  ) return null;

  const allowedEmails = new Set(
    env.ALLOWED_ACCESS_EMAILS.split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
  );
  if (allowedEmails.size === 0 ||
      [...allowedEmails].some(e => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e))) return null;
  const audience = env.ACCESS_AUDIENCE.trim();
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(audience)) return null;
  return { issuer: url.origin, audience, allowedEmails };
}

function remoteKeyResolver(issuer: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

/** Only a cryptographically verified signed assertion may supply a tenant. */
export async function authenticateAccess(
  request: Request,
  settings: AccessSettings,
  keyResolver: JWTVerifyGetKey = remoteKeyResolver(settings.issuer),
): Promise<AccessDecision> {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion || assertion.length > 16384) {
    return { ok: false, status: 401, code: "UNAUTHENTICATED" };
  }
  try {
    const { payload } = await jwtVerify(assertion, keyResolver, {
      issuer: settings.issuer,
      audience: settings.audience,
      algorithms: ["RS256"],
      clockTolerance: 5,
    });
    // An Access service token can have an empty subject. Only human users
    // are allowed by this project until machine access is designed separately.
    if (payload.type !== "app" || !isText(payload.sub) || !isText(payload.email)) {
      return { ok: false, status: 401, code: "UNAUTHENTICATED" };
    }
    const email = payload.email.trim().toLowerCase();
    if (!settings.allowedEmails.has(email)) {
      return { ok: false, status: 403, code: "NOT_ALLOWED" };
    }
    return { ok: true, principal: { tenantId: "cloudflare-access:" + payload.sub, email } };
  } catch {
    // No JWT, claim, signature or allowlist details in client-visible errors.
    return { ok: false, status: 401, code: "UNAUTHENTICATED" };
  }
}
