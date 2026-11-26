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

function designPage(api, request = async () => undefined, displayUrl = async url => url, { forgetReferenceImage, requireAccount, ...wxMethods } = {}) {
  let definition;
  const modules = new Map();
  const mocks = {
    'lib/auth.ts': { getAccount: () => ({ id: 'account' }), requireAccount: requireAccount ?? (async () => ({ id: 'account' })) },
    'lib/api.ts': { api },
    'lib/request.ts': { request, ApiError: MockApiError },
    'lib/files.ts': { displayUrl, forgetReferenceImage }
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
      Page: value => { definition = value; }, wx: { stopPullDownRefresh() {}, ...wxMethods }, Error, Date, console
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
const modeEvent = id => ({ currentTarget: { dataset: { id } }, detail: {} });

test('gallery captions use available Chinese attributes and skip missing or duplicate labels', async () => {
  const outfit = { id: 'outfit', image: null, primaryOccasion: 'COMMUTE', styles: ['MINIMAL'] };
  const page = designPage({
    hairstyles: async () => pageResult([hair('short'), { ...hair('archived'), length: null, texture: 'UNKNOWN', availability: 'UNAVAILABLE' }]),
    inspirations: async () => pageResult([
      outfit,
      { ...outfit, id: 'same-label', styles: ['COMMUTE'] },
      { id: 'old', name: '已下架的参考', availability: 'UNAVAILABLE', image: null }
    ])
  });
  await page.load();
  assert.deepEqual(Array.from(page.data.items, row => row.metaLabel), ['短发 · 直发', '']);
  await page.mode(modeEvent('OUTFIT'));
  assert.deepEqual(Array.from(page.data.items, row => row.metaLabel), ['通勤 · 简约', '通勤', '']);
  assert.equal(page.data.items[2].availability, 'UNAVAILABLE');
});

test('outfit details list the primary occasion first, summarize every known style and clear attributes for the next outfit', async () => {
  const full = {
    id: 'weekend', primaryOccasion: 'COMMUTE', occasions: ['DAILY', 'COMMUTE', 'OTHER', 'DATE'],
    styles: ['UNKNOWN', 'SOFT', 'COMMUTE', 'MINIMAL', 'SOFT'], image: { id: 'portrait', url: '/weekend' }
  };
  const archived = { id: 'archived', primaryOccasion: 'UNKNOWN', availability: 'UNAVAILABLE', image: null };
  const requests = [], images = [], previews = [];
  const page = designPage({ inspirations: async () => pageResult([]) }, async path => {
    requests.push(path);
    return path.endsWith('/weekend') ? full : archived;
  }, async (url, variant) => {
    images.push([url, variant]);
    return 'local:' + url;
  }, { previewImage: args => previews.push(structuredClone(args)) });
  await page.mode(modeEvent('OUTFIT'));
  await page.detail(modeEvent('weekend'));
  assert.equal(page.data.detailAttributes, '通勤 · 日常 · 约会 · 温柔 · 简约');
  page.preview({ currentTarget: { dataset: { url: page.data.detailImages[0].url } } });
  assert.deepEqual(previews, [{ current: 'local:/weekend', urls: ['local:/weekend'] }]);
  page.close();
  await page.detail(modeEvent('archived'));
  assert.equal(page.data.detailAttributes, '');
  assert.equal(page.data.detailImages.length, 0);
  assert.deepEqual(requests, ['/outfit-inspirations/weekend', '/outfit-inspirations/archived']);
  assert.deepEqual(images, [['/weekend', 'DISPLAY']]);
});

test('gallery filters submit the selected codes on page one and start each category with all options', async () => {
  const calls = [];
  const catalogue = kind => async (page, pageSize, filters) => {
    calls.push({ kind, page, pageSize, ...filters });
    return pageResult([], page, 22);
  };
  const page = designPage({ hairstyles: catalogue('hair'), inspirations: catalogue('outfit') });
  const choose = async (key, code, chip = false) => {
    const group = page.data.filterGroups.find(group => group.key === key);
    const index = group.options.findIndex(option => option.value === code);
    assert.ok(index >= 0);
    await page.filter({
      currentTarget: { dataset: chip ? { id: key, index } : { id: key } },
      detail: chip ? {} : { value: String(index) }
    });
  };
  await page.load();
  await page.more();
  page.toggleFilters();
  await choose('length', 'LONG', true);
  assert.equal(page.data.filtersOpen, false);
  page.toggleFilters();
  await choose('bangs', 'LIGHT');
  await choose('texture', 'WAVY');
  assert.deepEqual(calls.at(-1), { kind: 'hair', page: 1, pageSize: 20, scope: 'all', length: 'LONG', bangs: 'LIGHT', texture: 'WAVY' });
  assert.equal(page.data.filterSummary, '长发 · 轻薄 · 波浪');
  await page.favoriteScope();
  await page.mode(modeEvent('OUTFIT'));
  await choose('occasion', 'DATE', true);
  await choose('style', 'SPORT_CASUAL');
  assert.deepEqual(calls.at(-1), { kind: 'outfit', page: 1, pageSize: 20, scope: 'favorites', occasion: 'DATE', style: 'SPORT_CASUAL' });
  assert.equal(page.data.filterSummary, '约会 · 运动休闲');
  await choose('occasion', '', true);
  assert.equal(calls.at(-1).occasion, '');
  await page.mode(modeEvent('HAIRSTYLE'));
  assert.deepEqual(calls.at(-1), { kind: 'hair', page: 1, pageSize: 20, scope: 'favorites', length: '', bangs: '', texture: '' });
  assert.equal(page.data.filterSummary, '');
});

test('overall refresh reflects the latest profile gender and the galleries skip the profile request', async () => {
  let gender = 'MALE';
  let profileRequests = 0;
  const page = designPage({
    hairstyles: async () => pageResult([]),
    inspirations: async () => pageResult([]),
    profile: async () => {
      profileRequests++;
      return { gender };
    }
  });

  await page.load();
  await page.mode(modeEvent('OUTFIT'));
  assert.equal(profileRequests, 0);
  await page.mode(modeEvent('OVERALL'));
  assert.deepEqual(Array.from(page.data.overallExamples), ['MALE']);
  assert.equal(page.data.overallExampleGender, 'MALE');
  page.selectOverallExample(modeEvent('FEMALE'));
  assert.equal(page.data.overallExampleGender, 'MALE');
  assert.equal(profileRequests, 1);

  await page.more();
  assert.equal(profileRequests, 1);
  gender = 'FEMALE';
  await page.onPullDownRefresh();
  assert.deepEqual(Array.from(page.data.overallExamples), ['FEMALE']);
  assert.equal(page.data.overallExampleGender, 'FEMALE');
  assert.equal(profileRequests, 2);
});

test('overall shows both examples when profile gender is unset or unrecognized', async () => {
  let gender = null;
  const page = designPage({ profile: async () => ({ gender }) });
  await page.mode(modeEvent('OVERALL'));
  assert.deepEqual(Array.from(page.data.overallExamples), ['FEMALE', 'MALE']);
  assert.equal(page.data.error, '');

  gender = 'UNRECOGNIZED';
  await page.load();
  assert.deepEqual(Array.from(page.data.overallExamples), ['FEMALE', 'MALE']);
  assert.equal(page.data.error, '');
});

test('overall profile read failure keeps both examples and supports retry', async () => {
  let fail = true;
  const page = designPage({ profile: async () => {
    if (fail) throw new Error('offline');
    return { gender: 'MALE' };
  } });

  await page.mode(modeEvent('OVERALL'));
  assert.deepEqual(Array.from(page.data.overallExamples), ['FEMALE', 'MALE']);
  assert.equal(page.data.error, 'offline');
  assert.equal(page.data.busy, false);

  fail = false;
  await page.load();
  assert.deepEqual(Array.from(page.data.overallExamples), ['MALE']);
  assert.equal(page.data.error, '');
});

test('an offline account check still offers both bundled examples', async () => {
  const page = designPage({}, undefined, undefined, { requireAccount: async () => { throw Error('offline'); } });
  await page.mode(modeEvent('OVERALL'));
  assert.deepEqual(Array.from(page.data.overallExamples), ['FEMALE', 'MALE']);
  page.selectOverallExample(modeEvent('MALE'));
  assert.equal(page.data.overallExampleGender, 'MALE');
});

test('chosen example survives a refresh and opens its bundled image, while create uses no catalogue reference', async () => {
  let profileReads = 0, finishRefresh;
  const readFile = [], writeFile = [], previews = [], routes = [];
  const page = designPage({
    profile: async () => {
      if (++profileReads === 1) return { gender: null };
      return new Promise(resolve => { finishRefresh = resolve; });
    }
  }, undefined, undefined, {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getFileSystemManager: () => ({ readFile: options => readFile.push(options), writeFile: options => writeFile.push(options) }),
    previewImage: ({ current, urls }) => previews.push({ current, urls: Array.from(urls) }),
    navigateTo: ({ url }) => routes.push(url)
  });
  await page.mode(modeEvent('OVERALL'));
  page.selectOverallExample(modeEvent('MALE'));
  const refresh = page.onPullDownRefresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.overallExampleGender, 'MALE');
  finishRefresh({ gender: null });
  await refresh;
  assert.equal(page.data.overallExampleGender, 'MALE');

  const expectedFile = '/assets/overall-design-example-male.jpg';
  const destination = 'wxfile://usr/overall-design-example-male.jpg';
  const bytes = fs.readFileSync(path.join(source, expectedFile));
  for (let click = 0; click < 2; click++) {
    page.previewOverallExample();
    assert.equal(readFile[click].filePath, expectedFile);
    readFile[click].success({ data: bytes });
    assert.equal(writeFile[click].filePath, destination);
    assert.equal(writeFile[click].data, bytes);
    writeFile[click].success();
    assert.deepEqual(previews[click], { current: destination, urls: [destination] });
  }
  page.previewOverallExample();
  readFile[2].success({ data: bytes });
  page.onHide();
  writeFile[2].success();
  assert.equal(previews.length, 2);

  page.create(modeEvent(''));
  assert.deepEqual(routes, ['/pages/design-create/index?mode=OVERALL']);
  assert.equal(profileReads, 2);
});

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

test('a favorite that completes after close updates the gallery without reopening the detail', async () => {
  const item = hair('first');
  let finishFavorite;
  const page = designPage({ hairstyles: async () => pageResult([item]) }, url => {
    if (url.endsWith('/favorite')) return new Promise(resolve => { finishFavorite = resolve; });
    return item;
  });
  await page.load();
  await page.detail(modeEvent('first'));
  const save = page.favorite();
  page.close();
  finishFavorite();
  await save;
  assert.equal(page.data.detail, null);
  assert.equal(page.data.items[0].favorited, true);
  assert.equal(page.data.detailImages.length, 0);
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
  assert.deepEqual(structuredClone(page.data.detailImages), [{ id: 'side', label: '侧面', url: 'https://images.example/side' }]);
  assert.ok(page.data.detailImageWarning);
});

test('reference covers request thumbnails and details request the display variant', async () => {
  const item = hair('first');
  const variants = [];
  const page = designPage({ hairstyles: async () => pageResult([item]) }, async () => item, async (url, variant) => {
    variants.push(variant);
    return url;
  });
  await page.load();
  await page.detail({ currentTarget: { dataset: { id: 'first' } }, detail: {} });
  assert.deepEqual(variants, ['THUMBNAIL', 'DISPLAY']);
});

test('hair angles follow their IDs, default to front and preview the selected local image without another read', async () => {
  const item = { ...hair('crop'), bangs: 'LIGHT', images: [
    { id: 'b', angle: 'BACK', url: '/back' }, { id: 'f', angle: 'FRONT', url: '/front' }, { id: 's', angle: 'SIDE', url: '/side' }
  ] };
  const reads = [], previews = [];
  const page = designPage({}, async path => path.endsWith('crop') ? item : hair('next'), async (url, variant) => {
    reads.push([url, variant]);
    return 'local:' + url;
  }, { previewImage: args => previews.push(structuredClone(args)) });
  await page.detail(modeEvent('crop'));
  assert.equal(page.data.detailAttributes, '短发 · 轻薄刘海 · 直发');
  assert.deepEqual(Array.from(page.data.detailImages, v => [v.id, v.label]), [['f', '正面'], ['s', '侧面'], ['b', '背面']]);
  assert.equal(page.data.detailImages[page.data.detailImageIndex].id, 'f');
  page.selectDetailImage(modeEvent('b'));
  page.preview({ currentTarget: { dataset: { url: 'local:/back' } } });
  assert.deepEqual(previews, [{ urls: ['local:/front', 'local:/side', 'local:/back'], current: 'local:/back' }]);
  assert.equal(reads.length, 3);
  assert.ok(reads.every(([, variant]) => variant === 'DISPLAY'));
  page.close();
  await page.detail(modeEvent('next'));
  assert.equal(page.data.detailImages[page.data.detailImageIndex].id, 'image-next');
});

test('retry loads only failed angles, preserves a usable choice and ignores late native image errors', async () => {
  const item = { ...hair('crop'), images: [
    { id: 'f', angle: 'FRONT', url: '/front' }, { id: 's', angle: 'SIDE', url: '/side' }, { id: 'b', angle: 'BACK', url: '/back' }
  ] };
  const reads = [], evictions = [];
  let fail = true;
  const page = designPage({}, async () => item, async url => {
    reads.push(url);
    if (fail && url === '/front') throw Error('offline');
    return url + '-' + reads.length;
  }, { forgetReferenceImage: (...args) => evictions.push(args) });
  await page.detail(modeEvent('crop'));
  assert.equal(page.data.detailImages[page.data.detailImageIndex].id, 's');
  page.selectDetailImage(modeEvent('b'));
  fail = false;
  await page.retryImages();
  assert.equal(reads.length, 4);
  assert.equal(reads.at(-1), '/front');
  assert.equal(page.data.detailImages[page.data.detailImageIndex].id, 'b');
  assert.equal(page.data.detailImageWarning, '');
  const badPath = page.data.detailImages[page.data.detailImageIndex].url;
  const error = { currentTarget: { dataset: { id: 'b', url: badPath } } };
  page.detailImageError(error);
  assert.deepEqual(evictions, [['/back', badPath, 'DISPLAY']]);
  assert.equal(page.data.detailImages[page.data.detailImageIndex].id, 'f');
  await page.retryImages();
  page.detailImageError(error);
  assert.equal(page.data.detailImages.length, 3);
  assert.equal(page.data.detailImageWarning, '');
});

test('an image resolving after close cannot replace the next reference or its single outfit image', async () => {
  let release, started;
  const loading = new Promise(resolve => { started = resolve; });
  const firstImage = new Promise(resolve => { release = resolve; });
  const outfit = { id: 'look', image: { id: 'full', url: '/outfit' } };
  const page = designPage({ inspirations: async () => pageResult([]) }, async path => path.endsWith('look') ? outfit : hair('first'), async url => {
    if (url.endsWith('first')) { started(); return firstImage; }
    return url;
  });
  const pending = page.detail(modeEvent('first'));
  await loading;
  await new Promise(resolve => setImmediate(resolve));
  page.close();
  await page.mode(modeEvent('OUTFIT'));
  await page.detail(modeEvent('look'));
  release('/old-photo');
  await pending;
  assert.equal(page.data.detail.id, 'look');
  assert.deepEqual(Array.from(page.data.detailImages, image => [image.id, image.url]), [['full', '/outfit']]);
  assert.equal(page.data.detailImageWarning, '');
});
