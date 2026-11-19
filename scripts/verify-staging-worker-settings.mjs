import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerName = 'github-agent-identities-staging';
const expectedBindings = [
  'ACCESS_AUDIENCE', 'ACCESS_ISSUER', 'ALLOWED_ACCESS_EMAILS', 'DB',
  'GH_APP_DESIGN_PRIVATE_KEY', 'GH_APP_READONLY_ENABLED', 'MCP_PUBLIC_HOSTNAME',
].sort();

function requireMatch(ok, message) {
  if (!ok) throw new Error(message);
}

/** Validate metadata only. Never inspect or print the private-key value. */
export function verifyStagingSettings(response, env, phase) {
  requireMatch(phase === 'before' || phase === 'after', 'Unknown verification phase');
  requireMatch(response?.success === true, 'Cloudflare settings request was unsuccessful');
  const settings = response.result;
  requireMatch(settings && Array.isArray(settings.bindings), 'Worker bindings are missing');
  const names = settings.bindings.map(b => b.name).sort();
  requireMatch(JSON.stringify(names) === JSON.stringify(expectedBindings), 'Unexpected staging binding names');
  const bindings = new Map(settings.bindings.map(b => [b.name, b]));

  for (const name of ['ACCESS_ISSUER', 'ACCESS_AUDIENCE', 'ALLOWED_ACCESS_EMAILS', 'MCP_PUBLIC_HOSTNAME']) {
    const binding = bindings.get(name);
    requireMatch(binding.type === 'plain_text' && binding.text === env[name], `Staging ${name} binding mismatch`);
  }
  const db = bindings.get('DB');
  requireMatch(db.type === 'd1' && db.id === env.STAGING_D1_DATABASE_ID, 'Staging D1 UUID mismatch');
  requireMatch(db.database_name == null || db.database_name === workerName, 'Unexpected D1 database name');
  requireMatch(bindings.get('GH_APP_DESIGN_PRIVATE_KEY').type === 'secret_text', 'App private-key secret binding missing');

  const readFlag = bindings.get('GH_APP_READONLY_ENABLED');
  const expectedFlag = phase === 'before' ? 'false' : 'true';
  requireMatch(readFlag.type === 'plain_text' && readFlag.text === expectedFlag, 'Read-only opt-in flag mismatch');
  requireMatch(settings.compatibility_date === '2026-11-18', 'Worker compatibility date mismatch');
  requireMatch(JSON.stringify(settings.compatibility_flags) === JSON.stringify(['nodejs_compat']), 'Worker compatibility flags mismatch');
}

export async function verifyLiveStaging(phase, env = process.env, fetchImpl = fetch) {
  requireMatch(phase === 'before' || phase === 'after', 'Unknown verification phase');
  for (const key of [
    'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'STAGING_D1_DATABASE_ID',
    'ACCESS_ISSUER', 'ACCESS_AUDIENCE', 'ALLOWED_ACCESS_EMAILS', 'MCP_PUBLIC_HOSTNAME',
  ]) requireMatch(typeof env[key] === 'string' && env[key].length > 0, `Missing ${key}`);

  const account = encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID);
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${workerName}/settings`, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    signal: AbortSignal.timeout(25_000),
  });
  requireMatch(response.ok, `Unable to inspect staging Worker (HTTP ${response.status})`);
  verifyStagingSettings(await response.json(), env, phase);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await verifyLiveStaging(process.argv[2]);
    console.log(`Staging Worker ${process.argv[2]}-deploy binding checks passed`);
  } catch (error) {
    // Output only our sanitized failure descriptions; never dump API response data.
    const message = error instanceof Error ? error.message : 'Unknown verification failure';
    console.error(`::error::${message}`);
    process.exitCode = 1;
  }
}
