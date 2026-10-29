import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/features/generation/hairstyleDraft.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { hairDraft, restoreHairDraft, chooseHairstyle, restrictionChoices } = module.exports;
const input = { designType: 'HAIRSTYLE', personFileId: '101', profileVersion: '7', requirements: '不要刘海', occasion: '通勤', style: '利落', hairstyleId: 'bob', hairstyleVersion: 'v1', useReferenceHairColor: true, constraintOverrides: ['DYE_REJECT'] };

test('switching to free design never submits a retained gallery target or its color permission', () => {
  const next = { ...input, ...restoreHairDraft('FREE', hairDraft(input)) };
  assert.equal(next.hairstyleId, null);
  assert.equal(next.hairstyleVersion, null);
  assert.equal(next.useReferenceHairColor, false);
  assert.deepEqual(next.constraintOverrides, []);
  assert.equal(next.personFileId, '101');
  assert.equal(next.requirements, '不要刘海');
});

test('gallery and free text drafts restore independently without granting old exceptions', () => {
  const gallery = hairDraft(input);
  const free = hairDraft({ ...input, ...restoreHairDraft('FREE', gallery), requirements: '想留长发', style: '自然' });
  const restored = { ...input, ...restoreHairDraft('GALLERY', gallery) };
  assert.equal(restored.requirements, '不要刘海');
  assert.equal(restored.hairstyleId, 'bob');
  assert.equal(restored.useReferenceHairColor, true);
  assert.deepEqual(restored.constraintOverrides, []);
  assert.equal(restoreHairDraft('FREE', free).requirements, '想留长发');
  assert.equal(gallery.requirements, '不要刘海');
});

test('choosing another style keeps photo and explicit adjustments but resets dye opt-in and exceptions', () => {
  const next = { ...input, ...chooseHairstyle('pixie', 'v2') };
  assert.equal(next.personFileId, '101');
  assert.equal(next.requirements, '不要刘海');
  assert.equal(next.hairstyleId, 'pixie');
  assert.equal(next.hairstyleVersion, 'v2');
  assert.equal(next.useReferenceHairColor, false);
  assert.deepEqual(next.constraintOverrides, []);
});

test('legacy requests lacking gallery fields have safe empty drafts', () => {
  const { hairstyleId, hairstyleVersion, useReferenceHairColor, ...legacy } = input;
  const next = restoreHairDraft('GALLERY', hairDraft(legacy));
  assert.equal(next.hairstyleId, null);
  assert.equal(next.hairstyleVersion, null);
  assert.equal(next.useReferenceHairColor, false);
  assert.deepEqual(next.constraintOverrides, []);
});

test('known conflicts are direct choices and other limitations remain available without duplicates', () => {
  const restrictions = [{ id: 'DYE_REJECT' }, { id: 'PERM_REJECT' }, { id: 'NO_SHORTENING' }];
  const choices = restrictionChoices(restrictions, [{ restrictionId: 'DYE_REJECT' }], []);
  assert.deepEqual(choices.direct, [{ id: 'DYE_REJECT' }]);
  assert.deepEqual(choices.optional, [{ id: 'PERM_REJECT' }, { id: 'NO_SHORTENING' }]);
});

test('a granted exception stays directly cancelable after recheck clears its conflict', () => {
  const restrictions = [{ id: 'DYE_REJECT' }, { id: 'NO_SHORTENING' }];
  const choices = restrictionChoices(restrictions, [], ['DYE_REJECT']);
  assert.deepEqual(choices.direct, [{ id: 'DYE_REJECT' }]);
  assert.deepEqual(choices.optional, [{ id: 'NO_SHORTENING' }]);
});
