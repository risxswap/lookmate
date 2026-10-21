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
function sessionHost() {
  const state=[]; let cursor=0; let initial={id:'1',username:'test',displayName:null,gender:null,birthDate:null,preferences:null,version:'1',currentMeasurement:null,currentMeasurementId:null,defaultPortraitId:null,defaultFullBodyId:null};
  const queue=[]; const requests=[]; let current;
  const hooks={
    useState(initialValue) {const index=cursor++;if(!(index in state))state[index]=typeof initialValue==='function'?initialValue():initialValue;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];},
    useRef(value){const index=cursor++;if(!(index in state))state[index]={current:value};return state[index];},
    useEffect(){},
  };
  const client={setQueryData(key,value){if(key[0]==='profile')initial=value;},async invalidateQueries(){}};
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
  function render(){cursor=0;current=module.exports.useProfileSession(initial);return current;}
  async function settled(){await new Promise(setImmediate);return render();}
  render();
  return {queue,requests,render,settled,get current(){return current;},profile:version=>({...initial,version})};
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
