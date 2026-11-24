import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

function load(file, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => dependencies[name], mod, mod.exports);
  return mod.exports;
}

test('changing a password and logging out clear every account recovery store before redirect', async () => {
  const paths = [];
  const data = { getItem(key) { return this[key] ?? null; }, removeItem(key) { delete this[key]; }, setItem(key, value) { this[key] = value; } };
  globalThis.sessionStorage = data;
  globalThis.window = { location: { replace: url => paths.push(url), pathname: '/app', search: '', hash: '' } };
  const key = 'lookmate:generation:a';
  const outfit = 'lookmate:outfit-job:v1:a:8';
  const planner = 'lookmate:planner:create:a';
  const generation = load('../src/features/generation/api.ts', {});
  const { endSession } = load('../src/features/auth/endSession.ts', {
    '../../api/client': { refreshCsrf: async () => { data.setItem(key, 'late write'); throw new Error('offline'); } },
    '../../app/navigation': { clearNavigationSession: () => data.removeItem('lookmate:navigation:v1') },
    '../generation/api': generation, '../hairstyles/drafts': load('../src/features/hairstyles/drafts.ts', {}),
    '../outfitInspirations/drafts': load('../src/features/outfitInspirations/drafts.ts', {}),
    '../outfits/api': load('../src/features/outfits/api.ts', {}),
    '../planner/api': load('../src/features/planner/api.ts', {}),
    './navigation': load('../src/features/auth/navigation.ts', {}),
  });
  const client = new (require('@tanstack/react-query').QueryClient)();
  for (const [reason, expected] of [['passwordChanged','/login?passwordChanged=1'],['logout','/login'],['expired','/login?returnTo=%2Fapp&expired=1']]) {
    for (const id of [key, outfit, planner, 'lookmate:navigation:v1', 'lookmate:hadSession', 'unrelated']) data.setItem(id, '1');
    client.setQueryData(['profile','a'], {id:'a'});
    await endSession(client, reason);
    assert.equal(paths.at(-1), expected);
    assert.equal(client.getQueryData(['profile','a']), undefined);
    for (const id of [key,outfit,planner,'lookmate:navigation:v1','lookmate:hadSession']) assert.equal(data.getItem(id), null);
    assert.equal(data.getItem('unrelated'), '1');
  }
});

test('a late accepted response cannot clear or navigate over a newer pending request', () => {
  let pending = {kind:'RETRY',key:'current',accountId:'a'};
  const invalidated = [];
  const { finishSubmission } = load('../src/features/generation/submission.ts', {
    './api': { readPending: () => pending, clearPending: () => { pending = null; } },
    '../hairstyles/drafts': { completeHairSubmission() {} },
    '../outfitInspirations/drafts': { completeOutfitSubmission() {} },
  });
  const client = { invalidateQueries: ({ queryKey }) => invalidated.push(queryKey) };
  assert.equal(finishSubmission(client, { ...pending, key:'obsolete' }), false);
  assert.equal(pending.key, 'current'); assert.equal(invalidated.length, 0);
  assert.equal(finishSubmission(client, pending), true);
  assert.equal(pending, null); assert.deepEqual(invalidated, [['designs','a'],['workspace','a']]);
});
