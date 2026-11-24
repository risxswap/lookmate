import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const event = (dataset, value) => ({currentTarget: {dataset}, detail: {value}});
const tick = () => new Promise(resolve => setImmediate(resolve));
const item = dressId => ({
  dressId, dressName: dressId, categoryId: 'tops', categoryName: '衣物', categoryCode: 'OTHER',
  imageFileIds: [`photo-${dressId}`], color: null, missing: false
});
const outfit = (changes = {}) => ({
  id: 'set', version: '1', revision: '0', name: '周五通勤', note: '袖口卷起', pinned: false,
  items: [item('shirt'), item('shoes')], scenes: ['通勤'], groups: [],
  sourceDesignId: 'design', sourceOutputFileId: 'source-image', ...changes
});
const job = (taskId, revision, kind) => ({
  taskId, outfitId: 'set', revision, kind, status: 'SUCCEEDED', actions: [], stale: false,
  createdAt: '2026-11-01', outputFileId: kind === 'IMAGE' ? taskId : null,
  result: {title: taskId, summary: taskId, items: []}, errorMessage: null
});
const noJobs = () => ({image: null, evaluation: null, latest: null});

// Use the page lifecycle and the actual request/asset helpers. The transport is entirely local.
function openFixture(initialOutfit, current = noJobs(), history = []) {
  const state = {outfit: initialOutfit, current, history, calls: [], previews: []};
  const storage = new Map();
  let page;
  function respond(options) {
    const url = new URL(options.url);
    const route = url.pathname.slice('/api'.length);
    const method = options.header['X-HTTP-Method-Override'] || options.method;
    state.calls.push({method, route, body: options.data});
    if (route === '/auth/me') return {id: 'account'};
    if (route === '/outfits/set' && method === 'GET') return structuredClone(state.outfit);
    if (route === '/outfits/set/ai-jobs/current') return state.current;
    if (route === '/photos') {
      const photos = [
        {id: 'portrait', fileId: 'portrait-file', photoType: 'PORTRAIT'},
        {id: 'full', fileId: 'full-file', photoType: 'FULL_BODY'}
      ];
      return {items: photos, page: 1, pageSize: 20, total: photos.length};
    }
    if (route === '/outfits/set/ai-jobs' && method === 'POST') {
      const image = job('generated-image', state.outfit.revision, 'IMAGE');
      state.current = {...state.current, image, latest: image};
      state.history.unshift(image);
      return image;
    }
    if (route === '/outfits/set/ai-jobs' && method === 'GET') {
      const page = Number(url.searchParams.get('page'));
      const pageSize = Number(url.searchParams.get('pageSize'));
      return {items: state.history.slice((page-1)*pageSize, page*pageSize), page, pageSize, total: state.history.length};
    }
    if (route.startsWith('/outfit-ai-jobs/')) return state.history.find(j => route.endsWith('/' + j.taskId));
    if (route.endsWith('/access')) {
      const fileId = route.split('/')[2];
      if (options.data.variant === 'DISPLAY' && state.unavailableImage === fileId) throw new Error('图片暂不可用');
      const signature = options.data.variant === 'THUMBNAIL' ? '?signature=' + state.calls.length : '';
      return {url: 'https://images.test/' + fileId + signature, expiresAt: '2099-01-01'};
    }
    if (route === '/dresses') {
      return {items: [{id: 'shirt', name: '衬衫', images: [{fileId: 'photo-shirt'}]}],
        page: 1, pageSize: 20, total: 1};
    }
    if (route === '/outfits' && method === 'POST') {
      state.outfit = outfit({name: options.data.name, items: options.data.dressIds.map(item), scenes: [],
        sourceDesignId: null, sourceOutputFileId: null});
      return state.outfit;
    }
    if (route === '/outfits/set' && method === 'PATCH') {
      assert.equal(options.data.version, state.outfit.version);
      const {dressIds, groupIds, ...fields} = options.data;
      state.outfit = {...state.outfit, ...fields, items: dressIds ? dressIds.map(item) : state.outfit.items,
        groups: groupIds ? groupIds.map(id => ({id})) : state.outfit.groups, revision: '1', version: '2'};
      state.current = noJobs();
      return state.outfit;
    }
    if (route === '/outfits/set/scenes' && method === 'PUT') {
      assert.equal(options.data.version, state.outfit.version);
      if (state.sceneError) throw state.sceneError;
      state.outfit = {...state.outfit, scenes: options.data.scenes, version: '3'};
      return state.outfit;
    }
    throw new Error('Unexpected request ' + method + ' ' + route);
  }
  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => options.success({statusCode: 200, data: {data: respond(options)}}),
    downloadFile: options => options.success({statusCode: 200, tempFilePath: options.url.replace('https://images.test/', '/tmp/')}),
    getUserCryptoManager: () => ({getRandomValues: options => options.success({randomValues: new ArrayBuffer(16)})}),
    showModal: options => options.success({confirm: true}), showToast() {}, stopPullDownRefresh() {},
    previewImage: options => state.previews.push({current: options.current, urls: Array.from(options.urls)})
  };
  const cache = new Map();
  const context = vm.createContext({wx, Error, Date, console, setTimeout, clearTimeout, Page: definition => {
    page = {...definition, data: structuredClone(definition.data), setData(values) {Object.assign(this.data, values);}};
  }});
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = {exports: {}};
    cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}
    }).outputText;
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context)(
      spec => load(path.resolve(path.dirname(file), spec + '.ts')), mod, mod.exports);
    return mod.exports;
  }
  load(path.resolve('src/lib/session.ts')).saveSession({account: {id: 'account'}, token: 'test', expiresAt: '2099-01-01'});
  load(path.resolve('src/pages/outfit-detail/index.ts'));
  return {page, state, async open(query = {id: 'set'}) {
    page.onLoad(query);
    await page.onShow();
    await tick();
    assert.equal(page.data.error, '');
  }};
}

test('saved detail shows the current image and evaluation independently of the latest task and history selection', async () => {
  const image = job('current-image', '2', 'IMAGE');
  const evaluation = job('current-evaluation', '2', 'EVALUATION');
  const old = {...job('old-image', '0', 'IMAGE'), stale: true};
  const {page, state, open} = openFixture(outfit({revision: '2'}), {image, evaluation, latest: evaluation}, [evaluation, image, old]);
  await open();
  assert.equal(page.data.editing, false);
  assert.match(page.data.heroImage, /current-image$/);
  assert.equal(page.data.evaluation.taskId, evaluation.taskId);
  assert.equal(page.data.showHistory, false);
  await page.toggleHistory();
  await page.selectJob(event({id: old.taskId}));
  assert.equal(page.data.selectedJob.stale, true);
  assert.match(page.data.jobImage, /old-image$/);
  assert.match(page.data.heroImage, /current-image$/);
  assert.equal(page.data.evaluation.taskId, evaluation.taskId);
  await page.previewHero();
  assert.match(state.previews.at(-1).urls[0], /current-image$/);
});

test('an edited outfit returns to its new collage and retains the original design image in history', async () => {
  const {page, state, open} = openFixture(outfit());
  await open();
  assert.match(page.data.heroImage, /source-image$/);

  await page.startEdit();
  page.field(event({field: 'name'}, '草稿'));
  page.onHide();
  await page.onShow();
  await tick();
  assert.equal(page.data.name, '草稿');
  await page.cancelEdit();
  assert.equal(page.data.editing, false);
  assert.equal(page.data.name, '周五通勤');
  assert.equal(state.calls.some(call => call.method === 'PATCH'), false);

  await page.startEdit();
  page.toggleDress(event({id: 'shoes'}));
  await page.save();
  assert.equal(page.data.error, '');
  assert.equal(page.data.editing, false);
  assert.equal(page.data.heroImage, '');
  assert.deepEqual(Array.from(page.data.collageItems, i => i.id), ['shirt']);
  const update = state.calls.find(call => call.method === 'PATCH');
  assert.deepEqual(Array.from(update.body.dressIds), ['shirt']);
  await page.toggleHistory();
  await page.previewSource();
  assert.match(state.previews.at(-1).urls[0], /source-image$/);

  state.current.image = job('new-image', '1', 'IMAGE');
  state.current.latest = state.current.image;
  await page.refresh();
  assert.match(page.data.heroImage, /new-image$/);
});

test('a new outfit stays editable after validation or a scene write failure, then retries without creating a duplicate', async () => {
  const {page, state, open} = openFixture(null);
  await open({});
  assert.equal(page.data.editing, true);
  page.field(event({field: 'name'}, '新搭配'));
  await page.save();
  assert.equal(page.data.editing, true);
  assert.equal(page.data.name, '新搭配');
  assert.ok(page.data.error);
  assert.equal(state.calls.some(call => call.route.startsWith('/outfits')), false);

  await page.chooseDresses();
  page.toggleDress(event({id: 'shirt'}));
  page.field(event({field: 'scenes'}, '周末'));
  state.sceneError = new Error('场景保存失败');
  await page.save();
  assert.equal(page.data.editing, true);
  assert.equal(page.data.scenes, '周末');
  assert.equal(page.data.error, '场景保存失败');
  state.sceneError = undefined;
  await page.save();
  assert.equal(page.data.error, '');
  assert.equal(page.data.editing, false);
  assert.equal(page.data.name, '新搭配');
  assert.equal(page.data.scenes, '周末');
  assert.equal(state.calls.filter(call => call.route === '/outfits' && call.method === 'POST').length, 1);
});

test('a collage opens the full-body picker on demand and uses the selected photo for the new hero', async () => {
  const {page, state, open} = openFixture(outfit({sourceDesignId: null, sourceOutputFileId: null}));
  await open();
  assert.equal(page.data.heroImage, '');
  assert.deepEqual(Array.from(page.data.collageItems, i => i.id), ['shirt', 'shoes']);
  assert.equal(state.calls.some(call => call.route === '/photos'), false);
  await page.choosePhotos();
  assert.equal(page.data.showPhotos, true);
  assert.deepEqual(Array.from(page.data.photos, p => p.fileId), ['full-file']);
  const submissions = () => state.calls.filter(call => call.route === '/outfits/set/ai-jobs' && call.method === 'POST');
  await page.selectPhoto(event({id: 'full-file'}));
  assert.equal(submissions().length, 0);
  await page.generate(event({kind: 'IMAGE'}));
  await tick();
  assert.equal(page.data.error, '');
  assert.equal(submissions().length, 1);
  assert.equal(submissions()[0].body.personFileId, 'full-file');
  assert.equal(submissions()[0].body.revision, '0');
  assert.match(page.data.heroImage, /generated-image$/);
});

test('item previews start with the tapped piece and include available images beyond the four-piece collage', async () => {
  const pieces = ['shirt', 'skirt', 'belt', 'coat', 'shoes', 'hat'].map(item);
  pieces[1].imageFileIds = [];
  pieces[3].missing = true; // Its outfit snapshot still has an image.
  const {page, state, open} = openFixture(outfit({items: pieces, sourceOutputFileId: null}));
  await open();
  assert.equal(state.calls.filter(call => call.body?.variant === 'DISPLAY').length, 0);
  state.unavailableImage = 'photo-belt';
  await page.previewItem(event({id: 'skirt'}));
  assert.equal(state.previews.length, 0);
  await page.previewItem(event({id: 'shoes'}));
  const image = name => 'https://images.test/photo-' + name;
  assert.deepEqual(state.previews, [{
    current: image('shoes'), urls: ['shirt', 'coat', 'shoes', 'hat'].map(image)
  }]);
  await page.previewItem(event({id: 'belt'}));
  assert.equal(state.previews.length, 1);
});


test('returning from full-screen outfit previews keeps rendered thumbnails and checks current results', async () => {
  const {page, state, open} = openFixture(outfit());
  await open();
  const covers = page.data.selectedItems;
  const collage = page.data.collageItems;
  const thumbnailRequests = () => state.calls.filter(call => call.body?.variant === 'THUMBNAIL').length;
  assert.equal(thumbnailRequests(), 2);

  await page.previewItem(event({id: 'shoes'}));
  assert.match(state.previews.at(-1).current, /photo-shoes$/);
  page.onHide();
  state.current.image = job('updated-image', '0', 'IMAGE');
  page.onShow();
  await tick();
  assert.equal(thumbnailRequests(), 2);
  assert.equal(page.data.selectedItems, covers);
  assert.equal(page.data.collageItems, collage);
  assert.match(page.data.heroImage, /updated-image$/);

  page.previewHero();
  page.onHide();
  page.onShow();
  await tick();
  assert.equal(page.data.selectedItems, covers);
  assert.equal(thumbnailRequests(), 2);

  state.outfit.items[0].imageFileIds = ['replacement'];
  await page.refresh();
  assert.equal(thumbnailRequests(), 3);
  assert.match(page.data.selectedItems[0].cover, /replacement/);
  assert.equal(page.data.selectedItems[1].cover, covers[1].cover);
});

test('an invalid local thumbnail can be refreshed without replacing its neighbors', async () => {
  const {page, state, open} = openFixture(outfit());
  await open();
  const [shirt, shoes] = page.data.selectedItems;
  const failure = event({id: shirt.id, src: shirt.cover});
  page.itemCoverFailed(failure);
  assert.equal(page.data.selectedItems[0].cover, '');
  assert.equal(page.data.collageItems[0].cover, '');

  await page.refresh();
  const repaired = page.data.selectedItems[0].cover;
  assert.ok(repaired);
  assert.notEqual(repaired, shirt.cover);
  assert.equal(page.data.collageItems[0].cover, repaired);
  assert.equal(page.data.selectedItems[1].cover, shoes.cover);
  assert.equal(state.calls.filter(call => call.body?.variant === 'THUMBNAIL').length, 3);
  page.itemCoverFailed(failure);
  assert.equal(page.data.selectedItems[0].cover, repaired);
});

test('renaming a saved outfit omits relations while explicit group clearing and scene-only edits keep their own writes', async () => {
  const {page, state, open} = openFixture(outfit({groups:[{id:'group',name:'周末'}]}));
  await open();
  page.setData({name:'新名称'});
  await page.save();
  const writes = () => state.calls.filter(call => call.method === 'PATCH' || call.method === 'PUT');
  assert.deepEqual(structuredClone(writes()[0].body), {name:'新名称',version:'1'});
  page.setData({groupIds:[]});
  await page.save();
  assert.deepEqual(structuredClone(writes()[1].body), {groupIds:[],version:'2'});
  page.setData({scenes:''});
  await page.save();
  assert.deepEqual(writes().map(call=>call.method), ['PATCH','PATCH','PUT']);
  assert.deepEqual(structuredClone(writes()[2].body.scenes), []);
});
