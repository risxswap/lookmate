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
    if(name==='../../api/client')return {ApiError:class ApiError extends Error{},request:async(path,options)=>{requests.push({path,...options});assert.ok(queue.length,'Unexpected HTTP request');const response=queue.shift();if(response instanceof Error)throw response;return response;}};
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
  assert.equal(h.current.comparison,null);assert.equal(h.current.dirty,false);assert.deepEqual(h.invalidations,[]);
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
