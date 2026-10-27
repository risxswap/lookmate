import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/features/profile/usePhotoSlotUpload.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function host(angle) {
  let cursor=0, current, blocked=false, slots, effects=[];
  const state=[], calls=[], session={unknown:null,confirmed:null,save:(input,done)=>calls.push({input,done})};
  const target={slot:'SUPPLEMENT',photo:{id:'old'},...(angle?{angle}:{})};
  const items=[{key:'draft',fileId:'new-file',status:'TEMP'}];
  const module={exports:{}};
  new Function('require','module','exports',compiled)(name=>{
    if(name==='react')return {useState(value){const n=cursor++;if(!(n in state))state[n]=value;return [state[n],next=>state[n]=typeof next==='function'?next(state[n]):next];},useRef(value){const n=cursor++;return state[n]??= {current:value};},useEffect(fn){effects.push(fn);}};
    if(name==='../wardrobe/ImageUpload')return {usableImage:item=>!!item.fileId&&['TEMP','READY'].includes(item.status)};
    throw Error(name);
  },module,module.exports);
  function render(){cursor=0;effects=[];current=module.exports.usePhotoSlotUpload(target,items,session,blocked,slots);}
  function flush(){render();for(const effect of effects)effect();render();}
  render();
  return {flush,calls,session,get current(){return current;},set blocked(v){blocked=v;},set slots(v){slots=v;}};
}
test('ready photo automatically saves once even when effects repeat',()=>{
  const h=host();h.flush();h.flush();h.flush();assert.equal(h.calls.length,1);
  assert.deepEqual(h.calls[0].input.body,{fileId:'new-file',slot:'SUPPLEMENT',replacePhotoId:'old'});
  h.calls[0].done();h.flush();assert.equal(h.current.saved,true);assert.equal(h.calls.length,1);
});
test('blocked session delays automatic submission; rejection requires explicit retry',()=>{
  const h=host();h.blocked=true;h.flush();assert.equal(h.calls.length,0);
  h.blocked=false;h.flush();h.flush();assert.equal(h.calls.length,1);
  h.current.persist();h.flush();assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0].input,h.calls[1].input);
});
test('unknown save never automatically resubmits after session recovery and can reconcile by read',()=>{
  const h=host();h.flush();h.session.unknown={};h.blocked=true;h.flush();assert.equal(h.current.uncertain,true);
  h.session.unknown=null;h.blocked=false;h.flush();h.current.persist();h.flush();assert.equal(h.calls.length,1);
  h.slots={portrait:null,fullBody:null,supplements:[{id:'new',fileId:'new-file'}]};h.flush();
  assert.equal(h.current.saved,true);assert.equal(h.current.uncertain,false);assert.equal(h.calls.length,1);
});

test('fixed angle upload includes its angle and reconciles only that slot',()=>{
  const h=host('SIDE_FACE');h.flush();
  assert.equal(h.calls[0].input.body.angle,'SIDE_FACE');
  h.session.unknown={};h.blocked=true;h.flush();
  h.session.unknown=null;h.blocked=false;
  h.slots={portrait:null,fullBody:null,supplements:[{fileId:'new-file'}],angles:{BACK_HEAD:{fileId:'new-file'},SIDE_FACE:null}};h.flush();
  assert.equal(h.current.saved,false);
  h.slots={portrait:null,fullBody:null,supplements:[],angles:{SIDE_FACE:{fileId:'new-file'}}};h.flush();
  assert.equal(h.current.saved,true);assert.equal(h.calls.length,1);
});
