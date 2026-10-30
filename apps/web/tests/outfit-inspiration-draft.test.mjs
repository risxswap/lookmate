import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
function store() {
  const compiled = ts.transpileModule(readFileSync(new URL('../src/features/outfitInspirations/drafts.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('module', 'exports', compiled)(module, module.exports); return module.exports;
}
const input = { designType: 'OUTFIT', personFileId: '100', profileVersion: '1', requirements: '保留轮廓', occasion: '', style: '', weatherNote: '', requiredDressIds: ['dress-1'], useMeasurements: true, measurementId: null, constraintOverrides: ['DYE_REJECT'], outfitInspirationId: 'bob', outfitInspirationVersion: 'v2', useReferenceHairColor: true };
test('station navigation retains drafts independently and shares only the chosen person photo', () => {
  const s = store(); s.activateOutfitAccount('a'); s.saveOutfitDraft('a', 'gallery', input);
  const free = s.initialOutfitInput('a', 'free', { ...input, requirements: '' });
  assert.equal(free.outfitInspirationId, null); assert.equal(free.personFileId, '100'); assert.equal(free.requirements, '');
  s.saveOutfitDraft('a', 'free', { ...free, requirements: '想留长发', personFileId: '101' });
  const gallery = s.readOutfitDraft('a', 'gallery').input;
  assert.equal(gallery.requirements, '保留轮廓'); assert.equal(gallery.personFileId, '101'); assert.deepEqual(gallery.constraintOverrides, []);
});
test('same history source restores edited input, another source replaces only when selected by caller', () => {
  const s = store(); s.activateOutfitAccount('a'); s.saveOutfitDraft('a', 'gallery', { ...input, requirements: '我已修改' }, 'old-task');
  assert.equal(s.initialOutfitInput('a', 'gallery', input, undefined, 'old-task').requirements, '我已修改');
  assert.equal(s.initialOutfitInput('a', 'gallery', input, undefined, 'new-task').requirements, '保留轮廓');
});
test('new target keeps text and photo but resets reference color and exceptions', () => {
  const s = store(); s.activateOutfitAccount('a'); s.saveOutfitDraft('a', 'gallery', input);
  const next = s.initialOutfitInput('a', 'gallery', input, { id: 'pixie', version: 'v3' });
  assert.equal(next.outfitInspirationId, 'pixie'); assert.equal(next.personFileId, '100'); assert.equal(next.requirements, '保留轮廓'); assert.equal(next.useMeasurements, true); assert.deepEqual(next.requiredDressIds, ['dress-1']); assert.equal(next.occasion, ''); assert.deepEqual(next.constraintOverrides, []);
});
test('account switch and logout clear drafts, stale account saves cannot restore private input', () => {
  const s = store(); s.activateOutfitAccount('a'); s.saveOutfitDraft('a', 'gallery', input); s.activateOutfitAccount('b');
  s.saveOutfitDraft('a', 'gallery', input); assert.equal(s.readOutfitDraft('b', 'gallery'), undefined);
  s.activateOutfitAccount('a'); assert.equal(s.readOutfitDraft('a', 'gallery'), undefined);
  s.saveOutfitDraft('a', 'free', input); s.clearOutfitDrafts(); assert.equal(s.readOutfitDraft('a', 'free'), undefined);
});
test('successful submit clears only submitted path, reload starts a fresh in-memory store', () => {
  const s = store(); s.activateOutfitAccount('a'); s.saveOutfitDraft('a', 'gallery', input); s.saveOutfitDraft('a', 'free', { ...input, outfitInspirationId: null, requirements: '自由设计' });
  s.clearOutfitDraft('a', 'gallery'); assert.equal(s.readOutfitDraft('a', 'gallery'), undefined); assert.equal(s.readOutfitDraft('a', 'free').input.requirements, '自由设计');
  assert.equal(store().readOutfitDraft('a', 'free'), undefined);
});
test('pending create path overrides URL and source to prevent hidden target submissions', () => {
  const s = store(); assert.equal(s.outfitEditorPath('free', false, input), 'gallery');
  assert.equal(s.outfitEditorPath('gallery', true, { ...input, outfitInspirationId: null }), 'free');
  assert.equal(s.outfitEditorPath(null, false), 'free'); assert.equal(s.outfitEditorPath('gallery', false), 'gallery');
});

test('explicit gallery return retains safe filters and scroll, never an external target', () => {
  const s = store(); s.activateOutfitAccount('a');
  s.rememberOutfitGallery('a', '/app/outfit-design?scope=favorites&page=3&style=MINIMAL', 340);
  assert.deepEqual(s.outfitGalleryReturn('a'), { href: '/app/outfit-design?scope=favorites&page=3&style=MINIMAL', scroll: 340 });
  s.rememberOutfitGallery('a', 'https://elsewhere.example', 0);
  assert.equal(s.outfitGalleryReturn('a').scroll, 340);
  s.activateOutfitAccount('b'); assert.deepEqual(s.outfitGalleryReturn('b'), { href: '/app/outfit-design', scroll: 0 });
});

test('retry recovery preserves ordinary drafts and create recovery clears only the exact submitted input', () => {
  const s = store(); s.activateOutfitAccount('a'); s.saveOutfitDraft('a', 'gallery', input);
  s.completeOutfitSubmission('a', { kind: 'RETRY', accountId: 'a', key: 'retry', sourceId: 'old', mode: 'FULL' });
  assert.equal(s.readOutfitDraft('a', 'gallery').input.requirements, input.requirements);
  s.completeOutfitSubmission('a', { kind: 'CREATE', accountId: 'a', key: 'old-create', previewToken: 'token', input: { ...input, requirements: '旧提交' } });
  assert.equal(s.readOutfitDraft('a', 'gallery').input.requirements, input.requirements);
  s.saveOutfitDraft('a', 'free', { ...input, outfitInspirationId: null, requirements: '另外的自由设计' });
  s.completeOutfitSubmission('a', { kind: 'CREATE', accountId: 'a', key: 'create', previewToken: 'token', input });
  assert.equal(s.readOutfitDraft('a', 'gallery'), undefined);
  assert.equal(s.readOutfitDraft('a', 'free').input.requirements, '另外的自由设计');
});

test('reference query failure, stale version and downlisted inspiration block generation without erasing the target', () => {
  const compiled = ts.transpileModule(readFileSync(new URL('../src/features/outfitInspirations/eligibility.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('module', 'exports', compiled)(module, module.exports);
  const ready = module.exports.outfitReferenceReady;
  const reference = { id: input.outfitInspirationId, version: input.outfitInspirationVersion, image: { url: '/safe' }, availability: 'AVAILABLE' };
  assert.equal(ready('gallery', input, reference, true, false), true);
  assert.equal(ready('gallery', input, reference, false, false), false);
  assert.equal(ready('gallery', input, reference, true, true), false);
  assert.equal(ready('gallery', input, { ...reference, version: 'v3' }, true, false), false);
  assert.equal(ready('gallery', input, { ...reference, availability: 'UNAVAILABLE' }, true, false), false);
  assert.equal(ready('gallery', input, undefined, false, false), false);
  assert.equal(ready('free', input, reference, true, false), false);
  assert.equal(ready('free', { ...input, outfitInspirationId: null, outfitInspirationVersion: null }, undefined, false, false), true);
});
