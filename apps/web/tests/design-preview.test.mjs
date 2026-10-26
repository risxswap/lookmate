import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/features/generation/useDesignPreview.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function host() {
  const state = []; let cursor = 0; let cleanup; const requests = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useEffect(effect) { if (!cleanup) cleanup = effect(); },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name === 'react' ? hooks : { request: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })) }, module, module.exports);
  const render = () => { cursor = 0; return module.exports.useDesignPreview(); };
  return { render, requests, unmount: () => cleanup() };
}
const input = n => ({ requirements: n, constraintOverrides: [] });
test('newer verification wins even if the aborted older transport resolves late', async () => {
  const h = host(); const old = h.render().check(input('old')); const current = h.render().check(input('new'));
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[1].resolve({ previewToken: 'new', canSubmit: true }); await current;
  h.requests[0].resolve({ previewToken: 'old', canSubmit: true }); await old;
  assert.equal(h.render().value.previewToken, 'new'); assert.equal(h.render().inputKey, JSON.stringify(input('new')));
});
test('closing pending confirmation prevents response from reopening or granting a token', async () => {
  const h = host(); const pending = h.render().check(input('one')); h.render().close();
  h.requests[0].resolve({ previewToken: 'late', canSubmit: true }); await pending;
  assert.equal(h.render().open, false); assert.equal(h.render().value, null); assert.equal(h.render().inputKey, '');
});
test('old failures cannot replace a newer success', async () => {
  const h = host(); const old = h.render().check(input('old')); const current = h.render().check(input('new'));
  h.requests[1].resolve({ previewToken: 'new' }); await current; h.requests[0].reject(new Error('old failure')); await old;
  assert.equal(h.render().error, null); assert.equal(h.render().loading, false);
});
test('input edits immediately invalidate a previously valid token', async () => {
  const h = host(); const pending = h.render().check(input('one')); h.requests[0].resolve({ previewToken: 'one', canSubmit: true }); await pending;
  h.render().invalidate(); assert.equal(h.render().inputKey, ''); assert.equal(h.render().loading, false);
});
test('unmount cancels ownership of success and failure callbacks', async () => {
  const h = host(); const pending = h.render().check(input('one')); h.unmount();
  h.requests[0].reject(new Error('late failure')); await pending;
  assert.equal(h.render().error, null); assert.equal(h.render().value, null); assert.equal(h.requests[0].options.signal.aborted, true);
});
test('failed recheck never retains valid confirmation input', async () => {
  const h = host(); let pending = h.render().check(input('one')); h.requests[0].resolve({ previewToken: 'one', canSubmit: true }); await pending;
  pending = h.render().check(input('two')); h.requests[1].reject(new Error('unavailable')); await pending;
  assert.equal(h.render().inputKey, ''); assert.equal(h.render().error.message, 'unavailable'); assert.equal(h.render().loading, false);
});
