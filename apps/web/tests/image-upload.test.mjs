import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/features/wardrobe/ImageUpload.tsx', import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function mount(complete) {
  let items = [], tree, cursor = 0; const refs = [], effects = [], calls = [], revoked = [];
  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const jsx = (type, props) => ({ type, props }), module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'URL', compiled)(name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return { useRef: value => refs[cursor++] ??= { current: value }, useState: value => [value, () => {}], useEffect: fn => effects.push(fn) };
    if (name === 'antd') return { Alert: 'Alert', Button: 'Button', Image: 'Image', Space: 'Space', Tag: 'Tag', Typography: { Text: 'Text', Paragraph: 'Paragraph' } };
    if (name === '../../components/Feedback') return { Feedback: 'Feedback' };
    if (name === './PrivateImage') return { PrivateImage: 'PrivateImage' };
    if (name === '../../api/client') return { ApiError, request: async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith('upload-intents')) return { fileId: '7', key: 'object', uploadUrl: 'https://upload.example', token: 'token' };
      return complete ? complete(ApiError) : { status: 'TEMP' };
    } };
    throw new Error(name);
  }, module, module.exports, async (_, options) => { calls.push({ path: 'storage', options }); return { ok: true }; }, { createObjectURL: () => 'blob:preview', revokeObjectURL: url => revoked.push(url) });
  function render() { cursor = 0; effects.length = 0; tree = module.exports.ImageUpload({ accountId: '1', items, setItems: fn => { items = fn(items); }, disabled: false }); }
  function nodes(node = tree) { if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(Infinity).filter(child => child != null).flatMap(child => nodes(child))]; }
  render(); const cleanup = effects[0](); effects[1]();
  return { get items() { return items; }, calls, revoked,
    select() { nodes().find(n => n.type === 'input').props.onChange({ target: { files: [new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' })], value: 'x' } }); },
    retry() { render(); return nodes().find(n => typeof n.type === 'function').props.onRetry(); },
    remove() { render(); nodes().find(n => n.type === 'Button' && n.props.children === '移除').props.onClick(); render(); effects[1](); },
    dispose: cleanup, usable: module.exports.usableImage };
}
test('local preview precedes complete and becomes usable without polling', async () => {
  const ui = mount(); ui.select(); assert.equal(ui.items[0].previewUrl, 'blob:preview'); assert.equal(ui.usable(ui.items[0]), false);
  await tick(); assert.equal(ui.usable(ui.items[0]), true);
  assert.deepEqual(ui.calls.map(c => c.path), ['/files/upload-intents', 'storage', '/files/7/complete']);
  ui.remove(); assert.deepEqual(ui.revoked, ['blob:preview']);
});
test('retry registers the same object without reuploading', async () => {
  let attempt = 0; const ui = mount(() => { if (++attempt === 1) throw new Error('network'); return { status: 'TEMP' }; });
  ui.select(); await tick(); assert.equal(ui.items[0].completePending, true);
  ui.retry(); await tick(); assert.equal(ui.usable(ui.items[0]), true); assert.equal(ui.items[0].error, undefined);
  assert.equal(ui.calls.filter(c => c.path === 'storage').length, 1); ui.dispose();
});
test('invalid upload does not offer futile registration retry', async () => {
  const ui = mount(ApiError => { throw new ApiError(400, '格式不支持'); }); ui.select(); await tick();
  assert.equal(ui.items[0].completePending, false); assert.equal(ui.items[0].error, '格式不支持'); ui.dispose();
});
test('remove and unmount abort requests and ignore late completion', async () => {
  for (const action of ['remove', 'dispose']) {
    let resolve; const response = new Promise(r => { resolve = r; }); const ui = mount(() => response); ui.select(); await tick();
    const signal = ui.calls.at(-1).options.signal; ui[action](); const before = structuredClone(ui.items);
    resolve({ status: 'TEMP' }); await tick();
    assert.equal(signal.aborted, true); assert.deepEqual(ui.items, before); assert.deepEqual(ui.revoked, ['blob:preview']);
  }
});
