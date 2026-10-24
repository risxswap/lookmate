import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/features/profile/usePhotoLibrary.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(setImmediate);
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const draft = (key, photoType = 'PORTRAIT') => ({ key, fileId: `file-${key}`, name: `${key}.png`, status: 'TEMP', photoType });
function host(initial, respond, failRefresh = false) {
  let items = initial, cursor = 0, hook; const refs = [], effects = [], calls = [], saved = [];
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'react') return { useRef: value => refs[cursor++] ??= { current: value }, useEffect: callback => effects.push(callback) };
    if (name === '@tanstack/react-query') return { useQueryClient: () => ({ invalidateQueries: async () => { if (failRefresh) throw new Error('offline'); } }) };
    if (name === '../../api/client') return { ApiError, request: async (path, options = {}) => { calls.push({ path, ...options }); return respond(path, options); } };
    if (name === '../wardrobe/ImageUpload') return { usableImage: item => !!item.fileId && ['TEMP', 'READY'].includes(item.status) };
    throw new Error(name);
  }, module, module.exports);
  const render = () => { cursor = 0; effects.length = 0; hook = module.exports.usePhotoLibrary('account', items, update => { items = update(items); }, type => saved.push(type)); };
  render(); const dispose = effects[0]();
  const flush = async () => { render(); effects[1](); await tick(); render(); };
  return { calls, saved, get items() { return items; }, flush, render, dispose, retry: index => hook.retry(items[index]) };
}
test('each ready photo is automatically saved once, with its selected type snapshot', async () => {
  const h = host([draft('a'), draft('b', 'FULL_BODY')], async () => ({}));
  await h.flush(); await h.flush(); await h.flush();
  assert.equal(h.calls.length, 2); assert.ok(h.items.every(item => item.libraryStatus === 'SAVED'));
  assert.deepEqual(h.calls.map(call => call.body), [{ fileId: 'file-a', photoType: 'PORTRAIT' }, { fileId: 'file-b', photoType: 'FULL_BODY' }]);
});
test('partial rejection keeps success and retries only the failed original fileId', async () => {
  let rejected = false;
  const h = host([draft('a'), draft('b')], async (_, options) => { if (options.body.fileId === 'file-b' && !rejected) { rejected = true; throw new ApiError(429, '稍后重试'); } return {}; });
  await h.flush(); await h.flush(); assert.equal(h.calls.length, 2);
  assert.equal(h.items[0].libraryStatus, 'SAVED'); assert.equal(h.items[1].libraryStatus, 'ERROR');
  h.retry(1); h.retry(1); await h.flush();
  assert.equal(h.calls.length, 3); assert.deepEqual(h.calls[1].body, h.calls[2].body); assert.equal(h.items[1].libraryStatus, 'SAVED');
});
test('unknown write is reconciled through server pagination and never posted again', async () => {
  const h = host([draft('a')], async (path, options) => {
    if (options.method === 'POST') throw new ApiError(503, 'response lost');
    if (path.includes('page=1&')) return { total: 101, items: Array.from({ length: 100 }, (_, i) => ({ fileId: `other-${i}`, photoType: 'PORTRAIT' })) };
    return { total: 101, items: [{ fileId: 'file-a', photoType: 'PORTRAIT' }] };
  });
  await h.flush(); assert.equal(h.items[0].libraryStatus, 'UNKNOWN');
  h.retry(0); await h.flush();
  assert.equal(h.items[0].libraryStatus, 'SAVED'); assert.equal(h.calls.filter(call => call.method === 'POST').length, 1); assert.equal(h.calls.length, 3);
});
test('absent or unreadable reconciliation remains unknown without resubmission', async () => {
  let reads = 0;
  const h = host([draft('a')], async (_, options) => { if (options.method === 'POST') throw new Error('connection lost'); if (++reads === 1) throw new Error('read offline'); return { total: 0, items: [] }; });
  await h.flush(); h.retry(0); await h.flush(); h.retry(0); await h.flush();
  assert.equal(h.items[0].libraryStatus, 'UNKNOWN'); assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
});
test('list invalidation failure does not turn a successful write into a retry', async () => {
  const h = host([draft('a')], async () => ({}), true); await h.flush(); h.retry(0); await h.flush();
  assert.equal(h.items[0].libraryStatus, 'SAVED'); assert.equal(h.calls.length, 1);
});
test('in-flight guards survive repeated effect execution; unmount ignores late response', async () => {
  let resolve; const response = new Promise(done => { resolve = done; });
  const h = host([draft('a')], () => response); await h.flush(); await h.flush(); assert.equal(h.calls.length, 1);
  h.dispose(); resolve({}); await tick(); assert.equal(h.items[0].libraryStatus, 'SAVING'); assert.deepEqual(h.saved, []);
});
