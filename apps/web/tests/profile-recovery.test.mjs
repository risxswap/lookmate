import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { emptyPreferences } from '../src/features/profile/preferences.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/features/profile/useProfileSession.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

// Exercise the actual session callbacks against a deterministic hook-state host and
// queued HTTP responses. DOM scheduling and interactions are covered by browser QA.
class TestApiError extends Error {
  constructor(message, status, code) { super(message); this.status=status; this.detail={code}; }
}
function sessionHost({photoDirty = false, listError = false} = {}) {
  const state=[]; let cursor=0; let initial={id:'1',username:'test',displayName:null,gender:null,birthDate:null,preferences:null,version:'1',currentMeasurement:null,currentMeasurementId:null,defaultPortraitId:null,defaultFullBodyId:null};
  const queue=[]; const requests=[]; const invalidations=[]; let current;
  const hooks={
    useState(initialValue) {const index=cursor++;if(!(index in state))state[index]=typeof initialValue==='function'?initialValue():initialValue;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];},
    useRef(value){const index=cursor++;if(!(index in state))state[index]={current:value};return state[index];},
    useEffect(){},
  };
  const client={setQueryData(key,value){if(key[0]==='profile')initial=value;},async invalidateQueries(options){invalidations.push(options.queryKey);if(listError)throw new Error("list offline");}};
  const mockRequire=name=>{
    if(name==='react')return hooks;
    if(name==='@tanstack/react-query')return {useQueryClient:()=>client};
    if(name==='../../api/client')return {ApiError:TestApiError,request:async(path,options)=>{requests.push({path,...options});assert.ok(queue.length,'Unexpected HTTP request');const response=queue.shift();if(response instanceof Error)throw response;return response;}};
    if(name==='../auth/queries')return {accountKey:['account']};
    if(name==='./queries')return {measurementValues:value=>({height:value?.height??null})};
    if(name==='./preferences')return {emptyPreferences};
    throw new Error(`Unexpected import ${name}`);
  };
  const module={exports:{}};new Function('require','module','exports',compiled)(mockRequire,module,module.exports);
  function render(){cursor=0;current=module.exports.useProfileSession(initial,photoDirty);return current;}
  async function settled(){await new Promise(setImmediate);return render();}
  render();
  return {queue,requests,invalidations,render,settled,get current(){return current;},profile:version=>({...initial,version})};
}

test('unknown save -> compare old profile -> retry succeeds: stale comparison cannot roll back saved version',async()=>{
  const h=sessionHost();h.queue.push(new Error('connection lost'));
  h.current.save({path:'/profile/measurements',method:'POST',scope:'measurements',body:{gender:'FEMALE',height:166}});await h.settled();
  assert.ok(h.current.unknown);
  h.queue.push(h.profile('1'));await h.current.refresh();h.render();assert.equal(h.current.comparison.version,'1');
  const saved={...h.profile('2'),gender:'FEMALE',currentMeasurementId:'9',currentMeasurement:{height:166}};
  h.queue.push({profile:saved});h.current.retry();await h.settled();
  assert.equal(h.current.comparison,null);assert.equal(h.current.unknown,null);assert.equal(h.current.blocked,false);
  h.current.resolve(false);h.render();assert.equal(h.current.baseline.version,'2');assert.equal(h.current.values.height,166);
  assert.deepEqual(h.requests[0].body,h.requests[2].body);assert.equal(h.requests[2].body.version,'1');
});

test('successful delete followed by external write still requires comparison',async()=>{
  const h=sessionHost();h.queue.push(null,{...h.profile('3'),displayName:'Other device'});
  h.current.save({path:'/photos/9',method:'DELETE',scope:'photos'});await h.settled();
  assert.equal(h.current.baseline.version,'1');assert.equal(h.current.comparison.version,'3');assert.equal(h.current.blocked,true);
});

test('known successful delete with failed read only retries GET; matching response clears earlier comparison',async()=>{
  const h=sessionHost();h.queue.push(new Error('lost'));h.current.save({path:'/photos/9',method:'DELETE',scope:'photos'});await h.settled();
  h.queue.push(h.profile('1'));await h.current.refresh();h.render();
  h.queue.push(null,new Error('read failed'));h.current.retry();await h.settled();assert.ok(h.current.confirmed);
  h.queue.push(h.profile('2'));await h.current.refresh();h.render();
  assert.equal(h.current.comparison,null);assert.equal(h.current.confirmed,null);assert.equal(h.current.baseline.version,'2');
  assert.equal(h.requests.filter(r=>r.method==='DELETE').length,2);assert.equal(h.requests.at(-1).path,'/profile');
});


test('default gender is clean on entry; real edits and reverting are detected',()=>{
  const h=sessionHost();
  assert.equal(h.current.gender,'FEMALE');
  assert.equal(h.current.basicDirty,false);
  assert.equal(h.current.genderDirty,false);
  assert.equal(h.current.dirty,false);
  h.current.setGender('MALE');h.render();assert.equal(h.current.genderDirty,true);assert.equal(h.current.dirty,true);
  h.current.setGender('FEMALE');h.render();assert.equal(h.current.dirty,false);
  h.current.setName('New name');h.render();assert.equal(h.current.basicDirty,true);
  h.current.setName('');h.render();assert.equal(h.current.dirty,false);
  assert.equal(h.requests.length,0);
});

test('saving another tab and adopting server data with null gender stay clean',async()=>{
  const h=sessionHost();h.queue.push(h.profile('2'));
  h.current.save({path:'/profile/preferences',method:'PATCH',scope:'preferences',body:emptyPreferences()});await h.settled();
  assert.equal(h.current.dirty,false);
  h.current.setGender('MALE');h.render();
  h.queue.push(h.profile('3'));await h.current.refresh();h.render();
  h.current.resolve(false);h.render();
  assert.equal(h.current.gender,'FEMALE');assert.equal(h.current.dirty,false);
});


test('clean refresh adopts latest basic, measurements and preferences without comparison', async () => {
  const h=sessionHost();const next={...h.profile('2'),displayName:'Latest',gender:'MALE',currentMeasurement:{height:177},preferences:{...emptyPreferences(),outfitNote:'New note'}};
  h.queue.push(next);await h.current.refresh('basic');h.render();
  assert.equal(h.current.name,'Latest');assert.equal(h.current.gender,'MALE');assert.equal(h.current.values.height,177);assert.equal(h.current.preferences.outfitNote,'New note');
  assert.equal(h.current.comparison,null);assert.equal(h.current.dirty,false);assert.deepEqual(h.invalidations,[['photos','1'],['file-access','1']]);
});

test('refresh preserves edited fields and requires comparison with latest server data', async () => {
  const h=sessionHost();h.current.setName('Draft');h.render();h.queue.push({...h.profile('2'),displayName:'Server'});
  await h.current.refresh('preferences');h.render();assert.equal(h.current.name,'Draft');assert.equal(h.current.baseline.version,'1');assert.equal(h.current.comparison.displayName,'Server');
});

test('photo drafts are protected and photo refresh renews lists and private image access', async () => {
  const h=sessionHost({photoDirty:true});h.queue.push({...h.profile('2'),displayName:'Server'});
  await h.current.refresh('photos');h.render();assert.equal(h.current.baseline.version,'1');assert.ok(h.current.comparison);
  assert.deepEqual(h.invalidations,[['photos','1'],['file-access','1']]);
});

test('measurement refresh invalidates history and list failure does not discard successful profile read', async () => {
  const h=sessionHost({listError:true});h.queue.push({...h.profile('2'),displayName:'Latest'});
  await h.current.refresh('measurements');h.render();assert.equal(h.current.name,'Latest');assert.match(h.current.error,/刷新失败/);assert.equal(h.current.busy,false);
  assert.deepEqual(h.invalidations,[['measurements','1']]);assert.equal(h.requests.length,1);
});

test('failed refresh keeps current input and can be retried without a write', async () => {
  const h=sessionHost();h.queue.push(new Error('offline'));await h.current.refresh('photos');h.render();
  assert.equal(h.current.baseline.version,'1');assert.match(h.current.error,/资料刷新失败/);assert.equal(h.current.busy,false);
  h.queue.push({...h.profile('2'),displayName:'Recovered'});await h.current.refresh('photos');h.render();assert.equal(h.current.name,'Recovered');assert.equal(h.current.error,'');
  assert.ok(h.requests.every(r=>r.path==='/profile'&&!r.method));
});


test('failed refresh clears the previous successful refresh notice', async () => {
  const h=sessionHost();h.queue.push(h.profile('1'));await h.current.refresh('basic');h.render();assert.match(h.current.notice,/已刷新/);
  h.queue.push(new Error('Failed to fetch'));await h.current.refresh('basic');h.render();assert.equal(h.current.notice,'');assert.equal(h.current.error,'资料刷新失败，请重试。');
});


test('current-only save keeps draft on lost response and retries the same PATCH without adding history', async () => {
  const h=sessionHost();h.current.setValues({height:169});h.render();
  h.queue.push(new Error('connection lost'));
  h.current.save({path:'/profile/current-measurement',method:'PATCH',scope:'measurements',body:{gender:'FEMALE',height:169}});
  await h.settled();assert.equal(h.current.values.height,169);assert.equal(h.current.sizesDirty,true);assert.ok(h.current.unknown);
  h.queue.push({...h.profile('2'),gender:'FEMALE',currentMeasurementId:'20',currentMeasurement:{height:169}});
  h.current.retry();await h.settled();
  assert.equal(h.current.unknown,null);assert.equal(h.current.sizesDirty,false);assert.match(h.current.notice,/未新增历史/);
  assert.equal(h.requests.length,2);assert.deepEqual(h.requests[0],h.requests[1]);
  assert.ok(h.requests.every(r=>r.path==='/profile/current-measurement'&&r.method==='PATCH'));
});


test('photo slot save advances version but preserves unsaved basic information', async () => {
  const h=sessionHost();h.current.setName('Unsaved nickname');h.current.setBirthDate('1999-06-15');h.render();
  h.queue.push({...h.profile('2'),defaultPortraitId:'55'});
  h.current.save({path:'/photos/slots',method:'POST',scope:'photos',body:{slot:'PORTRAIT',fileId:'9007199254790001'}});await h.settled();
  assert.equal(h.current.baseline.version,'2');assert.equal(h.current.baseline.defaultPortraitId,'55');
  assert.equal(h.current.name,'Unsaved nickname');assert.equal(h.current.birthDate,'1999-06-15');assert.equal(h.current.basicDirty,true);
});

test('lost photo slot response retains the original version and file for safe retry', async () => {
  const h=sessionHost();h.queue.push(new Error('lost response'));
  h.current.save({path:'/photos/slots',method:'POST',scope:'photos',body:{slot:'SUPPLEMENT',replacePhotoId:'4',fileId:'9007199254790002'}});await h.settled();
  assert.ok(h.current.unknown);assert.equal(h.current.blocked,true);
  h.queue.push(h.profile('2'));h.current.retry();await h.settled();
  assert.deepEqual(h.requests[0],h.requests[1]);assert.equal(h.requests[1].body.version,'1');
  assert.equal(h.current.unknown,null);
});

function editWholeForm(h) {
  h.current.setName(' Draft ');h.current.setBirthDate('1999-06-15');h.current.setGender('MALE');
  h.current.setValues({height:178});h.current.setPreferences({...emptyPreferences(),outfitNote:' Draft note '});h.render();
  return {path:'/profile/form',method:'PUT',scope:'form',body:{displayName:'Draft',birthDate:'1999-06-15',gender:'MALE',measurements:{height:178},preferences:{...emptyPreferences(),outfitNote:'Draft note'}}};
}
function savedWholeForm(h,version='2') {
  return {...h.profile(version),displayName:'Draft',birthDate:'1999-06-15',gender:'MALE',currentMeasurement:{height:178},preferences:{...emptyPreferences(),outfitNote:'Draft note'}};
}

test('whole form saves in one request and adopts normalized values across every group', async()=>{
  const h=sessionHost();const input=editWholeForm(h);h.queue.push(savedWholeForm(h));
  h.current.save(input);await h.settled();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].path,'/profile/form');assert.equal(h.requests[0].body.version,'1');
  assert.equal(h.current.name,'Draft');assert.equal(h.current.preferences.outfitNote,'Draft note');
  assert.equal(h.current.values.height,178);assert.equal(h.current.gender,'MALE');assert.equal(h.current.dirty,false);
});

test('whole form validation rejection retains all groups and baseline',async()=>{
  const h=sessionHost();const input=editWholeForm(h);h.queue.push(new TestApiError('invalid preference',400,'VALIDATION_ERROR'));
  h.current.save(input);await h.settled();
  assert.equal(h.current.name,' Draft ');assert.equal(h.current.values.height,178);assert.equal(h.current.preferences.outfitNote,' Draft note ');
  assert.equal(h.current.baseline.version,'1');assert.equal(h.current.dirty,true);assert.equal(h.current.unknown,null);assert.equal(h.current.blocked,false);
});

test('whole form conflict requires comparison and explicit save with the refreshed version',async()=>{
  const h=sessionHost();const input=editWholeForm(h);h.queue.push(new TestApiError('version conflict',409,'VERSION_CONFLICT'));
  h.current.save(input);await h.settled();assert.equal(h.current.conflict,true);
  h.current.save(input);assert.equal(h.requests.length,1);
  h.queue.push({...h.profile('4'),displayName:'Remote'});await h.current.refresh('form');h.render();
  assert.equal(h.current.name,' Draft ');assert.equal(h.current.values.height,178);assert.equal(h.current.preferences.outfitNote,' Draft note ');
  assert.deepEqual(h.invalidations,[['photos','1'],['file-access','1'],['measurements','1']]);
  h.current.resolve(true);h.render();assert.equal(h.requests.length,2);assert.equal(h.current.baseline.version,'4');
  h.queue.push(savedWholeForm(h,'5'));h.current.save(input);await h.settled();
  assert.equal(h.requests.at(-1).body.version,'4');assert.equal(h.current.dirty,false);
});

test('unknown whole form result preserves a complete request and retries its original version',async()=>{
  const h=sessionHost();const input=editWholeForm(h);h.queue.push(new Error('lost response'));
  h.current.save(input);await h.settled();assert.ok(h.current.unknown);assert.equal(h.current.blocked,true);
  assert.equal(h.current.name,' Draft ');assert.equal(h.current.values.height,178);
  h.queue.push(savedWholeForm(h));h.current.retry();await h.settled();
  assert.deepEqual(h.requests[0],h.requests[1]);assert.equal(h.current.dirty,false);assert.equal(h.current.unknown,null);
});

test('history save commits only dimensions and shared gender while keeping other form drafts',async()=>{
  const h=sessionHost();editWholeForm(h);
  h.queue.push({profile:{...h.profile('2'),gender:'MALE',currentMeasurement:{height:178}},measurement:{id:'10',height:178}});
  h.current.save({path:'/profile/measurements',method:'POST',scope:'measurements',body:{gender:'MALE',height:178}});await h.settled();
  assert.equal(h.current.sizesDirty,false);assert.equal(h.current.genderDirty,false);
  assert.equal(h.current.name,' Draft ');assert.equal(h.current.birthDate,'1999-06-15');assert.equal(h.current.preferences.outfitNote,' Draft note ');
  assert.equal(h.current.basicDirty,true);assert.equal(h.current.preferencesDirty,true);assert.match(h.current.notice,/新增历史/);
});

test('photo writes preserve drafts in every form group and the next form save uses their new version',async()=>{
  const h=sessionHost();const input=editWholeForm(h);
  h.queue.push({...h.profile('2'),defaultPortraitId:'55'});
  h.current.save({path:'/photos/slots',method:'POST',scope:'photos',body:{slot:'PORTRAIT',fileId:'9007199254790001'}});await h.settled();
  assert.equal(h.current.name,' Draft ');assert.equal(h.current.values.height,178);assert.equal(h.current.preferences.outfitNote,' Draft note ');
  h.queue.push(savedWholeForm(h,'3'));h.current.save(input);await h.settled();assert.equal(h.requests.at(-1).body.version,'2');assert.equal(h.current.dirty,false);
});
