import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (dataset = {}) => ({currentTarget: {dataset}, detail: {}});
const design = (changes = {}) => ({
  id: '42', designType: 'OVERALL', status: 'SUCCEEDED', actions: ['FAVORITE', 'NEW_FROM_INPUT'],
  resultId: '15', outputFileId: 'effect',
  inputSummary: {request: {requirements: '留一点长度'}, personPhoto: {fileId: 'original'}, personalContext: {profileVersion: '11'}},
  result: {title: '日常整体设计', summary: '方便通勤', wearingAdvice: '卷袖两层', items: [{dressId: '8'}],
    hairstyle: {hairstyleName: '自然短发', careAdvice: '吹干即可'}}, ...changes
});
const source = ts.transpileModule(fs.readFileSync('src/pages/design-detail/index.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}
}).outputText;

function fixture(task) {
  let page;
  let timer;
  const state = {task, account: 'account', calls: [], previews: [], confirms: [], confirm: true, redirects: []};
  const modules = {
    '../../features/page': {
      owner: async () => state.account, stillOwner: account => state.account === account,
      id: event => event.currentTarget.dataset.id, statusLabel: {}, isActive: status => status === 'GENERATING',
      async action(view, operation) {
        if (view.data.busy) return;
        view.setData({busy: true, error: ''});
        try {await operation();} catch (error) {view.setData({error: error.message});}
        finally {view.setData({busy: false});}
      }
    },
    '../../lib/api': {api: {design: async () => {
      if (state.readError) throw new Error('临时读取失败');
      return structuredClone(state.task);
    }}},
    '../../lib/files': {fileImageUrl: async id => state.photo && id === 'effect' ? state.photo : `/tmp/${id}`, forgetFileImage() {}},
    '../../lib/ui': {confirm: async content => {state.confirms.push(content); return state.confirm;}},
    '../../lib/request': {request: async (path, {method}) => {
      state.calls.push({path, method});
      if (path === '/favorites/15') state.task.actions = ['NEW_FROM_INPUT', method === 'PUT' ? 'UNFAVORITE' : 'FAVORITE'];
    }},
    '../../features/design': {
      pendingSubmission: () => state.pending || null,
      sendSubmission: async (pending, recover) => {state.recovered = {pending, recover}; state.pending = null; return {taskId: '43'};}
    },
    '../../lib/storage': {saveDraft: (mode, draft) => {state.draft = {mode, ...draft};}}
  };
  const context = {
    require: spec => modules[spec], exports: {},
    setTimeout: callback => {timer = callback; return 1;}, clearTimeout: () => {timer = null;},
    wx: {
      previewImage: ({current, urls}) => state.previews.push({current, urls: Array.from(urls)}),
      redirectTo: ({url}) => state.redirects.push(url), navigateTo: ({url}) => state.redirects.push(url)
    },
    Page: definition => {page = {...definition, data: structuredClone(definition.data), setData(changes) {Object.assign(this.data, changes);}};}
  };
  vm.runInNewContext(source, context);
  page.onLoad({id: '42'});
  return {page, state, hasTimer: () => !!timer, async poll() {assert.ok(timer); timer(); await tick();}};
}

test('output failure leaves the advice and original readable, and a retry rejoins the same preview', async () => {
  const {page, state} = fixture(design());
  let failPhoto;
  state.photo = new Promise((_, reject) => {failPhoto = reject;});
  await page.onShow();
  assert.equal(page.data.error, '');
  assert.equal(page.data.task.result.wearingAdvice, '卷袖两层');
  assert.equal(page.data.hairAdvice.at(-1).text, '吹干即可');
  assert.equal(page.data.output.status, 'loading');
  assert.equal(page.data.original.status, 'ready');
  failPhoto(new Error('图片暂不可用'));
  await tick();
  assert.equal(page.data.output.status, 'error');
  assert.equal(page.data.error, '');
  state.photo = Promise.resolve('/tmp/effect-retry');
  await page.retryImage();
  page.previewOriginal();
  page.previewOutput();
  assert.deepEqual(state.previews, [
    {current: '/tmp/original', urls: ['/tmp/effect-retry', '/tmp/original']},
    {current: '/tmp/effect-retry', urls: ['/tmp/effect-retry', '/tmp/original']}
  ]);
  page.imageError(event({src: '/tmp/effect-old'}));
  assert.equal(page.data.output.status, 'ready');
});

test('busy operations and transient read failures keep polling active until manual refresh is required', async () => {
  const {page, state, poll, hasTimer} = fixture(design({status: 'GENERATING', actions: [], outputFileId: null}));
  await page.onShow();
  assert.equal(page.data.error, '');
  page.data.busy = true;
  await poll();
  page.data.busy = false;
  state.readError = true;
  await poll();
  assert.equal(page.data.error, '临时读取失败');
  assert.equal(page.data.task.result.summary, '方便通勤');
  state.readError = false;
  state.task = design({status: 'UNKNOWN', actions: ['REFRESH', 'HIDE'], outputFileId: null});
  await poll();
  assert.equal(hasTimer(), false);
  assert.equal(page.data.canRefresh, true);
  assert.equal(page.data.recordActions[0].key, 'HIDE');
});

test('detail action changes and pending recovery respect server capabilities and confirmation', async () => {
  const {page, state} = fixture(design({outputFileId: null}));
  await page.onShow();
  assert.equal(page.data.error, '');
  assert.equal(page.data.output, null);
  await page.operate(event({id: 'UNFAVORITE'}));
  assert.equal(state.calls.length, 0);
  await page.operate(event({id: 'FAVORITE'}));
  assert.equal(page.data.favoriteAction, 'UNFAVORITE');
  state.confirm = false;
  await page.operate(event({id: 'UNFAVORITE'}));
  assert.equal(state.calls.length, 1);
  assert.equal(page.data.favoriteAction, 'UNFAVORITE');
  page.recreate();
  assert.equal(state.draft.requirements, '留一点长度');
  assert.equal(state.draft.personFileId, 'original');
  assert.equal(state.redirects.at(-1), '/pages/design-create/index?mode=OVERALL');

  state.task.actions = ['RETRY_IMAGE'];
  state.pending = {kind: 'RETRY', accountId: 'account', key: 'original-key', sourceId: '42', mode: 'IMAGE_ONLY'};
  await page.load();
  assert.equal(page.data.canRecreate, false);
  await page.operate(event({id: 'RETRY_IMAGE'}));
  assert.equal(state.confirms.length, 1);
  await page.recover(event());
  assert.equal(state.recovered.pending.key, 'original-key');
  assert.equal(state.recovered.recover, true);
  assert.equal(page.data.pending, null);
  assert.equal(state.redirects.at(-1), '/pages/design-detail/index?id=43');
});

test('a late image cannot update a detail page after unload or account change', async () => {
  for (const close of [({page}) => page.onUnload(), ({state}) => {state.account = 'other';}]) {
    const env = fixture(design());
    let finish;
    env.state.photo = new Promise(resolve => {finish = resolve;});
    await env.page.onShow();
    close(env);
    finish('/tmp/old-effect');
    await tick();
    assert.equal(env.page.data.output.url, '');
  }
});
