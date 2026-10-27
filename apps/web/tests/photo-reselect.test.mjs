import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/features/wardrobe/ImageUpload.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function host(replaceSingle = true) {
  let cursor = 0, tree, replace, replacementCount = 0;
  let items = [{ key: 'old', fileId: '15', status: 'READY', name: 'original.png', previewUrl: 'blob:old' }];
  const state = [], module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name === 'react') return { useRef: value => { const n = cursor++; return state[n] ??= { current: value }; }, useState: value => { const n = cursor++; if (!(n in state)) state[n] = value; return [state[n], next => state[n] = next]; }, useEffect() {} };
    if (name === 'antd') return { Button: 'button', Image: 'image', Space: 'space', Tag: 'tag', Typography: { Paragraph: 'p', Text: 'text' } };
    if (name === '../../api/client') return { ApiError: class extends Error {}, request: async path => path.endsWith('/upload-intents') ? { fileId: '16', key: 'fixture', token: 'fixture', uploadUrl: 'https://fixture.invalid/upload' } : { status: 'TEMP' } };
    return {};
  }, module, module.exports);
  function render() { cursor = 0; tree = module.exports.ImageUpload({ accountId: '1', items, setItems: next => { items = typeof next === 'function' ? next(items) : next; }, disabled: false, mode: 'photo', maxFiles: 1, replaceSingle, onReplaceSelected: () => replacementCount++, renderItem: (item, retry, remove, choose) => { replace = choose; return jsx('draft', { item }); } }); }
  function all(node, type) { if (!node) return []; if (Array.isArray(node)) return node.flatMap(n => all(n, type)); if (typeof node !== 'object') return []; return [...(node.type === type ? [node] : []), ...all(node.props?.children, type)]; }
  render();
  return { render, get items() { return items; }, get replacementCount() { return replacementCount; }, buttons: () => all(tree, 'button'), choose(files) { const input = all(tree, 'input')[0]; input.props.ref.current = { click() {} }; replace(); input.props.onChange({ target: { files, value: 'selected' } }); } };
}
test('selected photo hides upload box only for opted-in replacement flow', () => {
  assert.equal(host().buttons().length, 0);
  assert.equal(host(false).buttons().some(b => b.props.className === 'photo-dropzone'), true);
});
test('canceling replacement and invalid selection preserve selected photo and save state', () => {
  const h = host(); h.choose([]); h.render();
  assert.equal(h.items[0].fileId, '15'); assert.equal(h.replacementCount, 0);
  h.choose([new File(['invalid'], 'bad.txt', { type: 'text/plain' })]); h.render();
  assert.equal(h.items[0].fileId, '15'); assert.equal(h.replacementCount, 0);
});
test('valid reselect replaces the single draft and registers the new file without appending', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true });
  try {
    const h = host(); h.choose([new File(['fixture'], 'new.png', { type: 'image/png' })]);
    await new Promise(resolve => setImmediate(resolve)); h.render();
    assert.equal(h.replacementCount, 1); assert.equal(h.items.length, 1);
    assert.equal(h.items[0].name, 'new.png'); assert.equal(h.items[0].fileId, '16'); assert.equal(h.items[0].status, 'TEMP');
    assert.notEqual(h.items[0].key, 'old'); URL.revokeObjectURL(h.items[0].previewUrl);
  } finally { globalThis.fetch = originalFetch; }
});
