import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const source = path.resolve('src');

class MockApiError extends Error {
  constructor(code) { super(code); this.detail = { code }; }
}

function designPage(api, request = async () => undefined, displayUrl = async url => url) {
  let definition;
  const modules = new Map();
  const mocks = {
    'lib/auth.ts': { getAccount: () => ({ id: 'account' }), requireAccount: async () => ({ id: 'account' }) },
    'lib/api.ts': { api },
    'lib/request.ts': { request, ApiError: MockApiError },
    'lib/files.ts': { displayUrl },
    'lib/ui.ts': { errorMessage: error => error.message, query: () => '' }
  };
  function load(name) {
    const file = path.resolve(source, name.endsWith('.ts') ? name : `${name}.ts`);
    const relative = path.relative(source, file);
    if (mocks[relative]) return mocks[relative];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
    }).outputText;
    vm.runInNewContext(`(function(require, module, exports) { ${compiled}\n})`, {
      Page: value => { definition = value; }, wx: {}, Error, Date, console
    })(specifier => load(path.relative(source, path.resolve(path.dirname(file), specifier))), module, module.exports);
    return module.exports;
  }
  load('pages/design/index');
  return { ...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } };
}

const hair = id => ({
  id, name: id, version: '1', length: 'SHORT', bangs: 'NONE', texture: 'STRAIGHT',
  description: '', careAdvice: '', images: [{ id: `image-${id}`, angle: 'FRONT', url: `https://images.example/${id}` }],
  availability: 'AVAILABLE', favorited: false, favoritedAt: null
});
const pageResult = (items, page = 1, total = items.length) => ({ items, page, pageSize: 20, total });

test('failed first request after a design mode change retries page one without mixing the old catalogue', async () => {
  const requests = [];
  let fail = true;
  const page = designPage({
    hairstyles: async () => pageResult([hair('old-hair')], 1, 40),
    inspirations: async pageNumber => {
      requests.push(pageNumber);
      if (fail) throw new Error('offline');
      return pageResult([{ id: 'outfit', name: 'Outfit', image: null }], pageNumber);
    }
  });
  await page.load();
  await page.mode({ currentTarget: { dataset: { id: 'OUTFIT' } }, detail: {} });
  assert.equal(page.data.error, 'offline');
  fail = false;
  await page.more();
  assert.deepEqual(requests, [1, 1]);
  assert.deepEqual(Array.from(page.data.items, item => item.id), ['outfit']);
});

test('a saved reference keeps its favorite state when a later page rebuilds the visible catalogue', async () => {
  const first = hair('first');
  const page = designPage({
    hairstyles: async pageNumber => pageNumber === 1
      ? pageResult([first], 1, 21)
      : pageResult([hair('next')], 2, 21)
  });
  await page.load();
  page.setData({ detail: first });
  await page.favorite();
  await page.more();
  assert.equal(page.data.items.find(item => item.id === 'first').favorited, true);
  assert.deepEqual(Array.from(page.data.items, item => item.id), ['first', 'next']);
});

test('removing a favorite refreshes the favorites scope and its server total', async () => {
  let favorites = [{ ...hair('first'), favorited: true }, { ...hair('second'), favorited: true }];
  const page = designPage({ hairstyles: async () => pageResult(favorites) }, async () => {
    favorites = favorites.filter(item => item.id !== 'first');
  });
  page.setData({ scope: 'favorites' });
  await page.load();
  page.setData({ detail: favorites[0] });
  await page.favorite();
  assert.equal(page.data.total, 1);
  assert.equal(page.data.detail.favorited, false);
  assert.deepEqual(Array.from(page.data.items, item => item.id), ['second']);
});

test('a failed reference image keeps the real catalogue and total and can be retried independently', async () => {
  let fail = true;
  let metadataRequests = 0;
  const page = designPage({ hairstyles: async () => {
    metadataRequests++;
    return pageResult([hair('first'), hair('second')], 1, 24);
  } }, undefined, async url => {
    if (fail && url.endsWith('/first')) throw new Error('download failed');
    return url;
  });
  await page.load();
  assert.equal(page.data.error, '');
  assert.equal(page.data.total, 24);
  assert.equal(page.data.items.length, 2);
  assert.equal(page.data.items[0].cover, '');
  assert.equal(page.data.items[1].cover, 'https://images.example/second');
  assert.ok(page.data.imageWarning);
  fail = false;
  await page.retryImages();
  assert.equal(metadataRequests, 1);
  assert.equal(page.data.items[0].cover, 'https://images.example/first');
  assert.equal(page.data.imageWarning, '');
});

test('reference detail keeps successful images and metadata when one image cannot load', async () => {
  const item = hair('first');
  item.images.push({ id: 'side', angle: 'SIDE', url: 'https://images.example/side' });
  const page = designPage({}, async () => item, async url => {
    if (url.endsWith('/first')) throw new Error('download failed');
    return url;
  });
  await page.detail({ currentTarget: { dataset: { id: 'first' } }, detail: {} });
  assert.equal(page.data.detail.id, 'first');
  assert.equal(page.data.error, '');
  assert.deepEqual(Array.from(page.data.detailImages), ['https://images.example/side']);
  assert.ok(page.data.detailImageWarning);
});
