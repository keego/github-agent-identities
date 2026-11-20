import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyStagingSettings, verifyLiveStaging } from '../scripts/verify-staging-worker-settings.mjs';

const env = {
  CLOUDFLARE_API_TOKEN: 'fake-test-token', CLOUDFLARE_ACCOUNT_ID: 'test-account',
  ACCESS_ISSUER: 'https://example.cloudflareaccess.com', ACCESS_AUDIENCE: 'test-audience',
  ALLOWED_ACCESS_EMAILS: 'invited@example.test', MCP_PUBLIC_HOSTNAME: 'github-agent-identities-staging.example.workers.dev',
  STAGING_D1_DATABASE_ID: 'test-database-id',
};
const binding = (name, value) => ({ name, type: 'plain_text', text: value });
function fixture(phase = 'before') {
  return { success: true, result: { compatibility_date: '2026-11-18', compatibility_flags: ['nodejs_compat'],
    bindings: [
      binding('ACCESS_AUDIENCE', env.ACCESS_AUDIENCE), binding('ACCESS_ISSUER', env.ACCESS_ISSUER),
      binding('ALLOWED_ACCESS_EMAILS', env.ALLOWED_ACCESS_EMAILS),
      { name: 'DB', type: 'd1', id: env.STAGING_D1_DATABASE_ID },
      { name: 'GH_APP_DESIGN_PRIVATE_KEY', type: 'secret_text' },
      binding('GH_APP_READONLY_ENABLED', phase === 'before' ? 'false' : 'true'),
      binding('MCP_PUBLIC_HOSTNAME', env.MCP_PUBLIC_HOSTNAME),
    ],
  }};
}
test('strict staging pre/post config checks accept expected configuration', () => {
  verifyStagingSettings(fixture('before'), env, 'before');
  verifyStagingSettings(fixture('after'), env, 'before'); // repeat read-only deployment
  verifyStagingSettings(fixture('after'), env, 'after');
});
test('rejects extra bindings, wrong database, wrong user allowlist, missing secret, and unexpected read flag', () => {
  const cases = [
    x => x.result.bindings.push(binding('UNEXPECTED', '1')),
    x => x.result.bindings.find(b => b.name === 'DB').id = 'wrong',
    x => x.result.bindings.find(b => b.name === 'ALLOWED_ACCESS_EMAILS').text = 'wrong',
    x => x.result.bindings.splice(x.result.bindings.findIndex(b => b.name === 'GH_APP_DESIGN_PRIVATE_KEY'), 1),
    x => x.result.bindings.find(b => b.name === 'GH_APP_READONLY_ENABLED').text = 'unexpected',
  ];
  for (const mutate of cases) {
    const x = fixture(); mutate(x);
    assert.throws(() => verifyStagingSettings(x, env, 'before'));
  }
  assert.throws(() => verifyStagingSettings(fixture('before'), env, 'after'));
});
test('live verification uses exact Worker URL and does not expose response values', async () => {
  let visited;
  await verifyLiveStaging('before', env, async (url, options) => {
    visited = { url, headers: options.headers };
    return { ok: true, json: async () => fixture() };
  });
  assert.equal(visited.url, 'https://api.cloudflare.com/client/v4/accounts/test-account/workers/scripts/github-agent-identities-staging/settings');
  assert.equal(visited.headers.Authorization, 'Bearer fake-test-token');
  const bad = fixture(); bad.result.bindings.find(b => b.name === 'ALLOWED_ACCESS_EMAILS').text = 'not-for-logs@example.test';
  await assert.rejects(() => verifyLiveStaging('before', env, async () => ({ ok: true, json: async () => bad })), error => {
    assert.equal(error.message, 'Staging ALLOWED_ACCESS_EMAILS binding mismatch');
    return true;
  });
});
test('manual workflow runs the tested verifier rather than inline multiline curl and jq', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy-staging.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: node scripts\/verify-staging-worker-settings\.mjs before/);
  assert.match(workflow, /run: node scripts\/verify-staging-worker-settings\.mjs after/);
  assert.doesNotMatch(workflow, /\\\\$/m);
});
