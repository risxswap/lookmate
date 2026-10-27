import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/features/wardrobe/DressDetail.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function host() {
  let cursor = 0, tree;
  const state = [], module = { exports: {} };
  const images = [{ id: 'a', fileId: 'file-a', effectiveFeatures: { description: '正面描述', colors: ['蓝色'] }, manualFeatures: null, recognitionId: null, aiCurrent: true }, { id: 'b', fileId: 'file-b', effectiveFeatures: { description: '背面人工描述', colors: null }, manualFeatures: { description: '背面人工描述', colors: null }, recognitionId: null, aiCurrent: true }];
  const dress = { id: 'dress', name: '同一件外套', categoryId: 'coat', seasons: [], images, recognition: null };
  const jsx = (type, props, key) => ({ type, props, key });
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name === 'react') return { useState: initial => { const n = cursor++; if (!(n in state)) state[n] = initial; return [state[n], next => { state[n] = next; }]; }, useRef: initial => { const n = cursor++; return state[n] ??= { current: initial }; }, useEffect() {} };
    if (name === 'antd') return { Modal: 'modal', Button: 'button', Tag: 'tag', Space: 'space', Typography: { Title: 'heading', Paragraph: 'p', Text: 'text' } };
    if (name === './queries') return { useDress: () => ({ data: dress }), useWardrobeWrite: () => ({ isPending: false }), featureLabels: { description: '单品描述', colors: '颜色' }, recognitionLabels: {}, seasons: [] };
    if (name === './PrivateImage') return { PrivateImage: 'private-image' };
    if (name === './FeatureEditor') return { FeatureEditor: 'feature-editor', featureText: v => Array.isArray(v) ? v.join('、') : v };
    if (name === './DressEditor') return { DressEditor: 'dress-editor' };
    return {};
  }, module, module.exports);
  function all(node, predicate) { if (!node) return []; if (Array.isArray(node)) return node.flatMap(n => all(n, predicate)); if (typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)]; }
  function render() { cursor = 0; tree = module.exports.DressDetail({ accountId: 'account', id: dress.id, categories: [{ id: 'coat', name: '外套' }], onClose() {} }); }
  render();
  return { render, dress, find: predicate => all(tree, predicate), selectSecond() { all(tree, n => n.type === 'button' && n.props['aria-label'] === '选择第 2 张图片')[0].props.onClick(); render(); }, get tree() { return tree; } };
}
test('thumbnail switches image, features, manual markers and remount key together', () => {
  const h = host();
  const region = () => h.find(n => n.type === 'section' && n.props['aria-label'] === '图片特征')[0];
  assert.equal(region().key, 'a');
  h.selectSecond();
  assert.equal(h.find(n => n.type === 'private-image')[0].props.fileId, 'file-b');
  assert.equal(region().key, 'b'); // Remounting resets the feature scroll position.
  assert.equal(h.find(n => n.type === 'dd' && n.props['aria-label'] === '单品描述内容')[0].props.children, '背面人工描述');
  assert.equal(h.find(n => n.type === 'tag' && n.props.children === '已修订').length, 1);
  assert.equal(h.find(n => n.props.className === 'dress-feature-cleared').length, 1);
  assert.equal(h.find(n => n.props.className === 'dress-detail-name')[0].props.children, '同一件外套');
  const select = h.find(n => n.type === 'button' && n.props['aria-label'] === '选择第 2 张图片')[0];
  assert.equal(select.props['aria-pressed'], true);
});
test('feature editing targets selected image and retains editable scrolling', () => {
  const h = host(); h.selectSecond();
  h.find(n => n.type === 'button' && n.props.children === '修订特征')[0].props.onClick(); h.render();
  assert.equal(h.find(n => n.type === 'feature-editor')[0].props.image.id, 'b');
  assert.equal(h.tree.props.styles.body.overflowY, 'auto');
});
test('removed selection falls back to a valid image and its feature region', () => {
  const h = host(); h.selectSecond(); h.dress.images.splice(1, 1); h.render();
  assert.equal(h.find(n => n.type === 'private-image')[0].props.fileId, 'file-a');
  assert.equal(h.find(n => n.type === 'section' && n.props['aria-label'] === '图片特征')[0].key, 'a');
  assert.equal(h.tree.props.styles.body.overflow, 'hidden');
});
