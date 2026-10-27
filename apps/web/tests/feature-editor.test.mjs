import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/features/wardrobe/FeatureEditor.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function host() {
  let cursor = 0, tree, refreshOptions, closed = 0;
  const state = [], calls = [], module = { exports: {} };
  const image = { id: 'image-b', version: '1', effectiveFeatures: { viewType: 'FRONT', description: '原描述', colors: ['蓝色'], details: { neckline: '圆领', sleeve: '长袖' } } };
  class ApiError extends Error { constructor(code) { super(code); this.detail = { code }; } }
  const write = { isPending: false, isError: false, mutate(input, options) { calls.push({ input, options }); write.variables = input; } };
  const refresh = { isPending: false, mutate() {} };
  const jsx = (type, props) => ({ type, props });
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name === 'react') return { useState: initial => { const n = cursor++; if (!(n in state)) state[n] = initial; return [state[n], next => { state[n] = typeof next === 'function' ? next(state[n]) : next; }]; }, useEffect() {} };
    if (name === '@tanstack/react-query') return { useMutation: options => { refreshOptions = options; return refresh; } };
    if (name === 'antd') return { Button: 'button', Form: Object.assign('form', { Item: 'item' }), Input: Object.assign(() => {}, { TextArea: 'textarea' }), Select: 'select', Modal: 'modal', Space: 'space', Typography: { Paragraph: 'p' } };
    if (name === '../../components/Feedback') return { Feedback: 'feedback' };
    if (name === '../../api/client') return { ApiError, request() {} };
    if (name === './queries') return { countText: s => Array.from(s).length, featureLabels: { viewType: '拍摄视角', description: '单品描述', colors: '颜色', pattern: '图案', styleTags: '风格标签', fit: '版型', materialDescription: '材质说明', details: '细节' }, useWardrobeWrite: () => write };
    if (name.endsWith('.css')) return {};
    throw Error(name);
  }, module, module.exports);
  function all(node, predicate) { if (!node) return []; if (Array.isArray(node)) return node.flatMap(n => all(n, predicate)); if (typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)]; }
  function render() { cursor = 0; tree = module.exports.FeatureEditor({ accountId: 'account', dressId: 'dress', image, onClose: () => closed++ }); }
  const find = predicate => all(tree, predicate);
  const save = () => ({ props: { disabled: tree.props.okButtonProps.disabled, onClick: tree.props.onOk } });
  render();
  return { calls, write, refresh, find, render, save, get closed() { return closed; }, change(label, value) { const field = find(n => n.props['aria-label'] === label)[0]; field.props.onChange(field.type === 'select' ? value : { target: { value } }); render(); }, conflict() { write.isError = true; write.error = new ApiError('VERSION_CONFLICT'); render(); }, refreshed(images = [{ ...image, version: '2' }]) { refresh.data = { images }; refreshOptions.onSuccess(refresh.data); render(); } };
}
test('direct fields prefill and save only edited values without overriding other AI features', () => {
  const h = host(); assert.equal(h.save().props.disabled, true);
  assert.equal(h.find(n => n.props['aria-label'] === '单品描述内容')[0].props.value, '原描述');
  assert.equal(h.find(n => n.props['aria-label']?.endsWith('操作')).length, 0);
  h.change('单品描述内容', '新描述'); h.save().props.onClick();
  assert.deepEqual(h.calls[0].input, { path: '/dresses/dress/images/image-b', method: 'PATCH', body: { version: '1', manualFeatures: { description: '新描述' } } });
});
test('clearing values submits null, including all details, and unchanged blanks are omitted', () => {
  const h = host(); h.change('单品描述内容', ' '); h.change('颜色内容', []); h.change('拍摄视角内容', undefined); h.change('领口', ''); h.change('袖型', ''); h.change('图案内容', ''); h.save().props.onClick();
  assert.deepEqual(h.calls[0].input.body.manualFeatures, { viewType: null, description: null, colors: null, details: null });
});
test('partial detail clear retains other detail values', () => {
  const h = host(); h.change('领口', ''); h.save().props.onClick();
  assert.deepEqual(h.calls[0].input.body.manualFeatures, { details: { neckline: null, sleeve: '长袖', pocket: null, button: null } });
});
test('unchanged form and invalid input never submit, busy prevents repeated submission', () => {
  const h = host(); h.save().props.onClick(); assert.equal(h.calls.length, 0);
  h.change('颜色内容', [' ']); h.save().props.onClick(); assert.equal(h.calls.length, 0);
  h.change('颜色内容', ['蓝色']); h.change('单品描述内容', '变更'); h.write.isPending = true; h.render(); h.save().props.onClick(); assert.equal(h.calls.length, 0);
});
test('conflict retains input and waits for refreshed version; removed image cannot save', () => {
  const h = host(); h.change('单品描述内容', '保留的输入'); h.save().props.onClick(); h.conflict();
  assert.equal(h.save().props.disabled, true); h.save().props.onClick(); assert.equal(h.calls.length, 1);
  h.refreshed(); assert.equal(h.save().props.disabled, false); h.save().props.onClick();
  assert.deepEqual(h.calls[1].input.body, { version: '2', manualFeatures: { description: '保留的输入' } });
  h.refreshed([]); assert.equal(h.save().props.disabled, true);
});
test('cancel closes without submitting changes and failed save leaves input editable', () => {
  const h = host(); h.change('单品描述内容', '未保存内容'); h.write.isError = true; h.write.error = new Error('保存失败'); h.render();
  assert.equal(h.find(n => n.props['aria-label'] === '单品描述内容')[0].props.value, '未保存内容');
  h.find(n => n.type === 'modal')[0].props.onCancel(); assert.equal(h.closed, 1); assert.equal(h.calls.length, 0);
});

test('editor uses standard Modal actions with an independently scrollable body', () => {
  const h = host();
  const modal = h.find(n => n.type === 'modal')[0];
  assert.equal(modal.props.title, '编辑特征');
  assert.equal(modal.props.okText, '保存特征');
  assert.equal(modal.props.cancelText, '取消');
  assert.equal(modal.props.styles.body.overflowY, 'auto');
  assert.equal(h.find(n => n.props.className === 'dress-editor-footer').length, 0);
});
