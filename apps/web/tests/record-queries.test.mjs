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

test('plan edits refresh the affected days, count ranges, and new custom scenes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const reads = [];
  const hooks = load('../src/features/planner/api.ts', {
    '@tanstack/react-query': { useQuery: options => options, useQueryClient: () => client },
    '../../api/client': { request: async path => { reads.push(path); return {}; } },
  });
  const first = {date:'2026-11-30',scene:'通勤'};
  const moved = {date:'2026-12-02',scene:'客户会议'};
  const day = hooks.usePlans('a', first.date, 1);
  const otherDay = hooks.usePlans('a', moved.date, 1);
  const november = hooks.usePlanCalendar('a','2026-11-01','2026-11-30');
  const december = hooks.usePlanCalendar('a','2026-12-01','2026-12-31');
  const closed = hooks.usePlanCalendar('a','2026-11-23','2027-01-03',false);
  const scenes = hooks.useScenes('a',1);
  const otherAccount = hooks.usePlans('b', first.date, 1);
  const observers = [day,otherDay,november,december,closed,scenes,otherAccount].map(options => {
    client.setQueryData(options.queryKey,{});
    return new QueryObserver(client,options);
  });
  const stop = observers.map(observer => observer.subscribe(() => {}));
  const refresh = hooks.useRefreshPlans('a');
  async function expectReads(operation, expected) {
    reads.length = 0;
    await operation();
    assert.deepEqual([...reads].sort(), expected.sort());
  }
  const firstDay = '/outfit-plans?date=2026-11-30&page=1&pageSize=5';
  const nextDay = '/outfit-plans?date=2026-12-02&page=1&pageSize=5';
  const nov = '/outfit-plans/calendar?from=2026-11-01&to=2026-11-30';
  const dec = '/outfit-plans/calendar?from=2026-12-01&to=2026-12-31';
  const sceneList = '/outfit-scenes?page=1&pageSize=20';
  try {
    await expectReads(() => refresh(first,first),[firstDay]);
    await expectReads(() => refresh(first,{...first,scene:'聚会'}),[firstDay]);
    await expectReads(() => refresh(first,moved),[firstDay,nextDay,nov,dec,sceneList]);
    assert.equal(client.getQueryState(closed.queryKey).isInvalidated,true);
    await expectReads(() => refresh(null,moved),[nextDay,dec,sceneList]);
    await expectReads(() => refresh(moved,null),[nextDay,dec]);
    await expectReads(() => refresh(),[firstDay,nextDay,nov,dec,sceneList]);
  } finally { stop.forEach(unsubscribe => unsubscribe()); client.clear(); }
});

test('setting outfit scene tags refreshes its detail and old and new matching lists', async () => {
  const invalidate = [];
  const client = new QueryClient();
  const hooks = load('../src/features/planner/api.ts', {
    '@tanstack/react-query': { useQueryClient: () => client },
    '../../api/client': {},
  });
  const keys = [
    ['outfit','a','1'], ['outfit','a','2'], ['outfit-scenes','a',1],
    ...['','通勤','运动','聚会','周末聚餐','旅行'].map(scene => ['outfits','a',1,'',4,scene]),
    ['outfit-plans','a','2026-11-30',1], ['outfits','b',1,'',4,'运动'],
  ];
  for (const key of keys) client.setQueryData(key,{});
  client.getQueryCache().subscribe(event => {
    if (event.type === 'updated' && event.action.type === 'invalidate') invalidate.push(event.query.queryKey);
  });
  const refresh = hooks.useRefreshOutfitScenes('a',{id:'1',scenes:['通勤','聚会']});
  await refresh(['运动','周末聚餐']);
  assert.deepEqual(invalidate, [keys[0],keys[2],...keys.slice(3,8)]);
  client.clear();
});
