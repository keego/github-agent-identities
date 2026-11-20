import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerName = 'github-agent-identities-staging';
const legacyBindings = [
  'ACCESS_AUDIENCE', 'ACCESS_ISSUER', 'ALLOWED_ACCESS_EMAILS', 'DB',
  'GH_APP_DESIGN_PRIVATE_KEY', 'GH_APP_READONLY_ENABLED', 'MCP_PUBLIC_HOSTNAME',
].sort();
const pilotBindingNames = [
  'GH_APP_COMMENT_PILOT_ENABLED', 'GH_APP_COMMENT_PILOT_OWNER_TENANT_ID',
  'GH_APP_COMMENT_PILOT_REPOSITORY', 'GH_APP_COMMENT_PILOT_NUMBER',
];
const expectedBindings = [...legacyBindings, ...pilotBindingNames].sort();
function pilotEnabled(env) {
  return env.GH_APP_COMMENT_PILOT_ENABLED === 'true';
}
/** No credential or verified-user values are ever included in errors. */
export function validateStagingWritePilotEnv(env) {
  if (!pilotEnabled(env)) return;
  requireMatch(env.GH_APP_READONLY_ENABLED === 'true', 'Pilot writes require read-only GitHub tools');
  requireMatch(/^cloudflare-access:.+$/.test(env.GH_APP_COMMENT_PILOT_OWNER_TENANT_ID || ''),
    'Missing verified pilot owner tenant');
  const repo = env.GH_APP_COMMENT_PILOT_REPOSITORY || '';
  requireMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) && !repo.includes('..'),
    'Invalid pilot repository');
  const n = env.GH_APP_COMMENT_PILOT_NUMBER || '';
  requireMatch(/^[1-9][0-9]*$/.test(n) && Number.isSafeInteger(Number(n)), 'Invalid pilot PR number');
  const invited = (env.ALLOWED_ACCESS_EMAILS || '').split(',').map(x => x.trim()).filter(Boolean);
  requireMatch(invited.length === 1, 'Pilot writes require exactly one invited account');
}


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
  const isCurrent = JSON.stringify(names) === JSON.stringify(expectedBindings);
  const isLegacy = JSON.stringify(names) === JSON.stringify(legacyBindings);
  requireMatch(isCurrent || (phase === 'before' && isLegacy), 'Unexpected staging binding names');
  const bindings = new Map(settings.bindings.map(b => [b.name, b]));
  validateStagingWritePilotEnv(env);

  for (const name of ['ACCESS_ISSUER', 'ACCESS_AUDIENCE', 'ALLOWED_ACCESS_EMAILS', 'MCP_PUBLIC_HOSTNAME']) {
    const binding = bindings.get(name);
    requireMatch(binding.type === 'plain_text' && binding.text === env[name], `Staging ${name} binding mismatch`);
  }
  const db = bindings.get('DB');
  requireMatch(db.type === 'd1' && db.id === env.STAGING_D1_DATABASE_ID, 'Staging D1 UUID mismatch');
  requireMatch(db.database_name == null || db.database_name === workerName, 'Unexpected D1 database name');
  requireMatch(bindings.get('GH_APP_DESIGN_PRIVATE_KEY').type === 'secret_text', 'App private-key secret binding missing');

  const readFlag = bindings.get('GH_APP_READONLY_ENABLED');
  // A repeat deployment may already have read-only mode enabled. The explicit
  // workflow approval still controls whether the new upload enables it.
  const allowedFlags = phase === 'before' ? ['false', 'true'] : ['true'];
  requireMatch(readFlag.type === 'plain_text' && allowedFlags.includes(readFlag.text), 'Read-only opt-in flag mismatch');
  if (isCurrent) {
    for (const name of pilotBindingNames) {
      const b = bindings.get(name);
      requireMatch(b?.type === 'plain_text', 'Pilot config binding missing or wrong type');
      if (phase === 'after') {
        const expected = name === 'GH_APP_COMMENT_PILOT_ENABLED'
          ? (pilotEnabled(env) ? 'true' : 'false') : (env[name] || '');
        requireMatch(b.text === expected, 'Pilot config binding mismatch');
      }
    }
    requireMatch(['true', 'false'].includes(bindings.get('GH_APP_COMMENT_PILOT_ENABLED').text),
      'Invalid existing pilot activation flag');
  }
  requireMatch(settings.compatibility_date === '2026-11-18', 'Worker compatibility date mismatch');
  requireMatch(JSON.stringify(settings.compatibility_flags) === JSON.stringify(['nodejs_compat']), 'Worker compatibility flags mismatch');
}

export async function verifyLiveStaging(phase, env = process.env, fetchImpl = fetch) {
  requireMatch(phase === 'before' || phase === 'after', 'Unknown verification phase');
  validateStagingWritePilotEnv(env);
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
    if (process.argv[2] === 'validate-pilot') {
      validateStagingWritePilotEnv(process.env);
      console.log('Staging write pilot preflight passed');
    } else {
      await verifyLiveStaging(process.argv[2]);
      console.log(`Staging Worker ${process.argv[2]}-deploy binding checks passed`);
    }
  } catch (error) {
    // Output only our sanitized failure descriptions; never dump API response data.
    const message = error instanceof Error ? error.message : 'Unknown verification failure';
    console.error(`::error::${message}`);
    process.exitCode = 1;
  }
}
