import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPreferences, count, dictionaries, emptyPreferences, normalizeTags, preferenceErrors } from '../src/features/profile/preferences.ts';

test('normalizes Unicode whitespace and NFC, maps Chinese presets, retains first order', () => {
  assert.deepEqual(normalizeTags([
    {type:'CUSTOM',text:'\u0085 徒步 \u001c'}, {type:'CUSTOM',text:'e\u0301'},
    {type:'PRESET',code:'HIKING'}, {type:'CUSTOM',text:'é'}, {type:'CUSTOM',text:'城市漫步'},
  ],dictionaries.interests), [{type:'PRESET',code:'HIKING'},{type:'CUSTOM',text:'é'},{type:'CUSTOM',text:'城市漫步'}]);
});
test('counts Unicode code points and trims notes without changing internal newlines', () => {
  assert.equal(count('😀'.repeat(20)),20);
  const result=cleanPreferences({...emptyPreferences(),outfitNote:'\u0085  通勤\n方便走动 \u001c',hairNote:'  '});
  assert.equal(result.outfitNote,'通勤\n方便走动');assert.equal(result.hairNote,null);
});
test('rejects normalized color conflict and slim restriction while allowing short hair restriction', () => {
  const value={...emptyPreferences(),preferredColors:[{type:'CUSTOM',text:' 黑 '}],avoidedColors:[{type:'PRESET',code:'BLACK'}],fits:['SLIM'],hairLengths:['SHORT'],restrictions:['NO_TIGHT','NO_SHORTENING']};
  assert.equal(preferenceErrors(value).length,2);
  assert.deepEqual(preferenceErrors({...value,preferredColors:[],fits:[]}),[]);
});
test('does not truncate 21 tags or 501 code point notes', () => {
  const value={...emptyPreferences(),interests:Array.from({length:21},(_,i)=>({type:'CUSTOM',text:`活动${i}`})),hairNote:'😀'.repeat(501)};
  assert.equal(preferenceErrors(value).length,2);assert.equal(cleanPreferences(value).interests.length,21);
});
