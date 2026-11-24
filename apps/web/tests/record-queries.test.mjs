import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { QueryClient, QueryObserver } = require('@tanstack/react-query');
function load(path, dependencies = {}) {
  const js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}

test('only visible open outfit history polls an active page', () => {
  let visible = true;
  const { useJobs } = load('../src/features/outfits/api.ts', {
    '@tanstack/react-query': { useQuery: options => options },
    '../../api/client': {}, '../workspace/queries': { useVisible: () => visible, isActive: status => status === 'QUEUED' },
  });
  function options(open, status) {
    const query = useJobs('A', '10', 2, open);
    return [query.enabled, query.refetchInterval({state:{data:{items:[{status}]}}})];
  }
  assert.deepEqual(options(false, 'QUEUED'), [false, false]);
  assert.deepEqual(options(true, 'QUEUED'), [true, 3000]);
  assert.deepEqual(options(true, 'FAILED'), [true, false]);
  visible = false;
  assert.deepEqual(options(true, 'QUEUED'), [false, false]);
});

test('an empty folder write refetches folders, membership changes refetch favorites', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const reads = [];
  const request = async (path) => { reads.push(path); return { items: [], total: 0 }; };
  const hooks = load('../src/features/designs/queries.ts', {
    '@tanstack/react-query': { useQuery: o => o, useMutation: o => o, useQueryClient: () => client },
    '../workspace/queries': {}, '../../api/client': { request },
  });
  const active = [hooks.useCollections('a', 1), hooks.useFavorites('a', 1), hooks.useCollections('b', 1)];
  const stop = active.map(options => {
    client.setQueryData(options.queryKey, { items: [], total: 0 });
    return new QueryObserver(client, options).subscribe(() => {});
  });
  try {
    const mutation = hooks.useRecordWrite('a');
    for (const [change, expected] of [
      ['collection', ['/collections?page=1&pageSize=10']],
      ['membership', ['/favorites?page=1&pageSize=20']],
      ['deleteCollection', ['/collections?page=1&pageSize=10', '/favorites?page=1&pageSize=20']],
    ]) {
      reads.length = 0;
      await mutation.onSuccess({}, { change });
      assert.deepEqual(reads.sort(), expected);
    }
  } finally { stop.forEach(f => f()); client.clear(); }
});

test('existing outfit PATCH sends only touched fields, preserves order and explicit clears', () => {
  const { outfitBody } = load('../src/features/outfits/editor.ts');
  const original = { version: 'v4', name: '上班', note: '卷袖', pinned: true, items: [{dressId:'10'}, {dressId:'11'}], groups: [{id:'group1'}, {id:'group2'}] };
  const draft = { ...original, name: ' 通勤 ' };
  assert.deepEqual(outfitBody(draft, original), {version:'v4', name:'通勤'});
  assert.deepEqual(outfitBody({...draft, groups:[...original.groups].reverse()}, original), {version:'v4', name:'通勤'});
  assert.deepEqual(outfitBody({...original, note:'', pinned:false, groups:[], items:[...original.items].reverse()}, original),
    {version:'v4', note:null, pinned:false, groupIds:[], dressIds:['11','10']});
  assert.deepEqual(outfitBody(draft), {name:'通勤', note:'卷袖', pinned:true, groupIds:['group1','group2'], dressIds:['10','11']});
});

test('renaming an outfit only refreshes its card lists and matching detail', async () => {
  const keys = [];
  const client = { invalidateQueries: ({queryKey}) => keys.push(queryKey) };
  const { useOutfitWrite } = load('../src/features/outfits/api.ts', {
    '@tanstack/react-query': { useMutation: options => options, useQueryClient: () => client },
    '../../api/client': {}, '../workspace/queries': {},
  });
  const mutation = useOutfitWrite('a');
  await mutation.onSuccess({id:'1'}, {method:'PATCH', body:{version:'1',name:'new name'}});
  assert.deepEqual(keys, [['outfits','a'],['outfit','a','1']]);
  keys.length=0;
  await mutation.onSuccess({id:'1'}, {method:'PATCH', body:{version:'2',note:null}});
  assert.deepEqual(keys, [['outfits','a'],['outfit','a','1'],['outfit-jobs','a','1'],['outfit-current-jobs','a','1']]);
});


test('a reviewed version becomes the baseline for local reversions and explicit clears', () => {
  const { outfitBody, mergeOutfitDraft } = load('../src/features/outfits/editor.ts');
  const previous = {version:'1', name:'A', note:'old', pinned:false, items:[{dressId:'1'}], groups:[{id:'9'}]};
  const latest = {version:'2', name:'C', note:'remote', pinned:true, items:[{dressId:'2'}], groups:[{id:'4'}]};
  const reviewed = mergeOutfitDraft({...previous, name:'B'}, previous, latest);
  assert.deepEqual(reviewed, {name:'B', note:'remote', pinned:true, items:latest.items, groups:latest.groups});
  assert.deepEqual(outfitBody({...reviewed, name:'A'}, latest), {version:'2', name:'A'});
  const cleared = mergeOutfitDraft({...previous, name:'B', groups:[], note:''}, previous, latest);
  assert.deepEqual(outfitBody(cleared, latest), {version:'2', name:'B', groupIds:[], note:null});
});
