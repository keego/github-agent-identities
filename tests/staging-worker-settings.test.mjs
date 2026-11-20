import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyStagingSettings, verifyLiveStaging, validateStagingWritePilotEnv } from '../scripts/verify-staging-worker-settings.mjs';

const env = {
  CLOUDFLARE_API_TOKEN: 'fake-test-token', CLOUDFLARE_ACCOUNT_ID: 'test-account',
  ACCESS_ISSUER: 'https://example.cloudflareaccess.com', ACCESS_AUDIENCE: 'test-audience',
  ALLOWED_ACCESS_EMAILS: 'invited@example.test', MCP_PUBLIC_HOSTNAME: 'github-agent-identities-staging.example.workers.dev',
  STAGING_D1_DATABASE_ID: 'test-database-id',
  GH_APP_READONLY_ENABLED: 'true',
  GH_APP_COMMENT_PILOT_ENABLED: 'false',
  GH_APP_COMMENT_PILOT_OWNER_TENANT_ID: '',
  GH_APP_COMMENT_PILOT_REPOSITORY: '',
  GH_APP_COMMENT_PILOT_NUMBER: '',
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
      ...(phase === 'before' ? [] : [
        binding('GH_APP_COMMENT_PILOT_ENABLED', env.GH_APP_COMMENT_PILOT_ENABLED),
        binding('GH_APP_COMMENT_PILOT_OWNER_TENANT_ID', env.GH_APP_COMMENT_PILOT_OWNER_TENANT_ID),
        binding('GH_APP_COMMENT_PILOT_REPOSITORY', env.GH_APP_COMMENT_PILOT_REPOSITORY),
        binding('GH_APP_COMMENT_PILOT_NUMBER', env.GH_APP_COMMENT_PILOT_NUMBER),
      ]),
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

test('pilot activation requires owner, target, read flag and exactly one Access-invited user', () => {
  validateStagingWritePilotEnv(env); // default off
  const config = {
    ...env, GH_APP_COMMENT_PILOT_ENABLED: 'true',
    GH_APP_COMMENT_PILOT_OWNER_TENANT_ID: 'cloudflare-access:synthetic-owner',
    GH_APP_COMMENT_PILOT_REPOSITORY: 'keego/poster-brain',
    GH_APP_COMMENT_PILOT_NUMBER: '22',
    ALLOWED_ACCESS_EMAILS: 'owner@example.test',
  };
  validateStagingWritePilotEnv(config);
  for (const patch of [
    { GH_APP_READONLY_ENABLED: 'false' },
    { GH_APP_COMMENT_PILOT_OWNER_TENANT_ID: '' },
    { GH_APP_COMMENT_PILOT_OWNER_TENANT_ID: 'not-verified' },
    { GH_APP_COMMENT_PILOT_REPOSITORY: 'keego/../repo' },
    { GH_APP_COMMENT_PILOT_NUMBER: '0' },
    { GH_APP_COMMENT_PILOT_NUMBER: '2e3' },
    { ALLOWED_ACCESS_EMAILS: 'a@example.test,b@example.test' },
  ]) assert.throws(() => validateStagingWritePilotEnv({ ...config, ...patch }));

  const expected = fixture('after');
  for (const key of [
    'GH_APP_COMMENT_PILOT_ENABLED','GH_APP_COMMENT_PILOT_OWNER_TENANT_ID',
    'GH_APP_COMMENT_PILOT_REPOSITORY','GH_APP_COMMENT_PILOT_NUMBER'
  ]) expected.result.bindings.find(b => b.name === key).text = config[key];
  verifyStagingSettings(expected, config, 'after');
  assert.throws(() => verifyStagingSettings(expected, env, 'after'));
});

test('manual staging deploy never enables comments by default and requires explicit review', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy-staging.yml', import.meta.url), 'utf8');
  assert.match(workflow, /enable_github_app_pilot_comment:/);
  assert.match(workflow, /GH_APP_COMMENT_PILOT_ENABLED:.*enable_github_app_pilot_comment.*'false'/);
  assert.match(workflow, /node scripts\/verify-staging-worker-settings\.mjs validate-pilot/);
  assert.match(workflow, /GH_APP_COMMENT_PILOT_OWNER_TENANT_ID:.*secrets\./);
  assert.match(workflow, /APPROVE_VERIFIED_CONFIG_OVERRIDE/);
});
