import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/features/outfits/api.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const requests = [];
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => {
  if (name === '../../api/client') return { request: async (path, options) => { requests.push({ path, ...options }); return { taskId: '42' }; } };
  if (name === '@tanstack/react-query' || name === '../workspace/queries') return {};
  throw Error(name);
}, module, module.exports);
const api = module.exports;
globalThis.sessionStorage = { getItem(key) { return this[key] ?? null; }, setItem(key, value) { this[key] = value; }, removeItem(key) { delete this[key]; } };
test('uncertain submission survives reload, preserves idempotency key and stays account/outfit scoped', async () => {
  const pending = { key: 'original-key', outfitId: '8', body: { kind: 'EVALUATION', revision: '3' } };
  api.persistPendingJob('a', '8', pending);
  assert.equal(api.readPendingJob('b', '8'), null);
  assert.equal(api.readPendingJob('a', '9'), null);
  const recovered = api.readPendingJob('a', '8');
  assert.deepEqual(recovered, pending);
  await api.submitJob(recovered); await api.submitJob(recovered);
  assert.equal(requests[0].path, '/outfits/8/ai-jobs');
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(requests[0].body, { kind: 'EVALUATION', revision: '3' });
  assert.equal(requests[0].headers['Idempotency-Key'], 'original-key');
});
test('retry uses dedicated fixed-outfit endpoint and original mode', async () => {
  const pending = { key: 'retry-key', outfitId: '8', sourceId: '42', body: { mode: 'IMAGE_ONLY' } };
  await api.submitJob(pending);
  assert.equal(requests.at(-1).path, '/outfit-ai-jobs/42/retry');
  assert.deepEqual(requests.at(-1).body, { mode: 'IMAGE_ONLY' });
});
test('logout clears only outfit recovery; damaged records do not load', () => {
  sessionStorage.setItem('other-app', 'keep');
  sessionStorage.setItem('lookmate:outfit-job:v1:a:9', '{bad');
  assert.equal(api.readPendingJob('a', '9'), null);
  api.clearOutfitRecovery();
  assert.equal(api.readPendingJob('a', '8'), null);
  assert.equal(sessionStorage.getItem('other-app'), 'keep');
});
