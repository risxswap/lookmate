import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
function store() {
  const compiled = ts.transpileModule(readFileSync(new URL('../src/features/hairstyles/drafts.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('module', 'exports', compiled)(module, module.exports); return module.exports;
}
const input = { designType: 'HAIRSTYLE', personFileId: '100', profileVersion: '1', requirements: '保留轮廓', occasion: '日常', style: '', weatherNote: '', requiredDressIds: [], useMeasurements: false, measurementId: null, constraintOverrides: ['DYE_REJECT'], hairstyleId: 'bob', hairstyleVersion: 'v2', useReferenceHairColor: true };
test('station navigation retains drafts independently and shares only the chosen person photo', () => {
  const s = store(); s.activateHairAccount('a'); s.saveHairDraft('a', 'gallery', input);
  const free = s.initialHairInput('a', 'free', { ...input, requirements: '' });
  assert.equal(free.hairstyleId, null); assert.equal(free.personFileId, '100'); assert.equal(free.requirements, '');
  s.saveHairDraft('a', 'free', { ...free, requirements: '想留长发', personFileId: '101' });
  const gallery = s.readHairDraft('a', 'gallery').input;
  assert.equal(gallery.requirements, '保留轮廓'); assert.equal(gallery.personFileId, '101'); assert.deepEqual(gallery.constraintOverrides, []);
});
test('same history source restores edited input, another source replaces only when selected by caller', () => {
  const s = store(); s.activateHairAccount('a'); s.saveHairDraft('a', 'gallery', { ...input, requirements: '我已修改' }, 'old-task');
  assert.equal(s.initialHairInput('a', 'gallery', input, undefined, 'old-task').requirements, '我已修改');
  assert.equal(s.initialHairInput('a', 'gallery', input, undefined, 'new-task').requirements, '保留轮廓');
});
test('new target keeps text and photo but resets reference color and exceptions', () => {
  const s = store(); s.activateHairAccount('a'); s.saveHairDraft('a', 'gallery', input);
  const next = s.initialHairInput('a', 'gallery', input, { id: 'pixie', version: 'v3' });
  assert.equal(next.hairstyleId, 'pixie'); assert.equal(next.personFileId, '100'); assert.equal(next.requirements, '保留轮廓'); assert.equal(next.useReferenceHairColor, false); assert.deepEqual(next.constraintOverrides, []);
});
test('account switch and logout clear drafts, stale account saves cannot restore private input', () => {
  const s = store(); s.activateHairAccount('a'); s.saveHairDraft('a', 'gallery', input); s.activateHairAccount('b');
  s.saveHairDraft('a', 'gallery', input); assert.equal(s.readHairDraft('b', 'gallery'), undefined);
  s.activateHairAccount('a'); assert.equal(s.readHairDraft('a', 'gallery'), undefined);
  s.saveHairDraft('a', 'free', input); s.clearHairDrafts(); assert.equal(s.readHairDraft('a', 'free'), undefined);
});
test('successful submit clears only submitted path, reload starts a fresh in-memory store', () => {
  const s = store(); s.activateHairAccount('a'); s.saveHairDraft('a', 'gallery', input); s.saveHairDraft('a', 'free', { ...input, hairstyleId: null, requirements: '自由设计' });
  s.clearHairDraft('a', 'gallery'); assert.equal(s.readHairDraft('a', 'gallery'), undefined); assert.equal(s.readHairDraft('a', 'free').input.requirements, '自由设计');
  assert.equal(store().readHairDraft('a', 'free'), undefined);
});
test('pending create path overrides URL and source to prevent hidden target submissions', () => {
  const s = store(); assert.equal(s.hairEditorPath('free', false, input), 'gallery');
  assert.equal(s.hairEditorPath('gallery', true, { ...input, hairstyleId: null }), 'free');
  assert.equal(s.hairEditorPath(null, false), 'free'); assert.equal(s.hairEditorPath('gallery', false), 'gallery');
});

test('explicit gallery return retains safe filters and scroll, never an external target', () => {
  const s = store(); s.activateHairAccount('a');
  s.rememberHairGallery('a', '/app/hairstyles?scope=favorites&page=3&length=SHORT', 340);
  assert.deepEqual(s.hairGalleryReturn('a'), { href: '/app/hairstyles?scope=favorites&page=3&length=SHORT', scroll: 340 });
  s.rememberHairGallery('a', 'https://elsewhere.example', 0);
  assert.equal(s.hairGalleryReturn('a').scroll, 340);
  s.activateHairAccount('b'); assert.deepEqual(s.hairGalleryReturn('b'), { href: '/app/hairstyles', scroll: 0 });
});

test('retry recovery preserves ordinary drafts and create recovery clears only the exact submitted input', () => {
  const s = store(); s.activateHairAccount('a'); s.saveHairDraft('a', 'gallery', input);
  s.completeHairSubmission('a', { kind: 'RETRY', accountId: 'a', key: 'retry', sourceId: 'old', mode: 'FULL' });
  assert.equal(s.readHairDraft('a', 'gallery').input.requirements, input.requirements);
  s.completeHairSubmission('a', { kind: 'CREATE', accountId: 'a', key: 'old-create', previewToken: 'token', input: { ...input, requirements: '旧提交' } });
  assert.equal(s.readHairDraft('a', 'gallery').input.requirements, input.requirements);
  s.saveHairDraft('a', 'free', { ...input, hairstyleId: null, requirements: '另外的自由设计' });
  s.completeHairSubmission('a', { kind: 'CREATE', accountId: 'a', key: 'create', previewToken: 'token', input });
  assert.equal(s.readHairDraft('a', 'gallery'), undefined);
  assert.equal(s.readHairDraft('a', 'free').input.requirements, '另外的自由设计');
});
