import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = new URL('../src/', import.meta.url);
const ok = data => ({ statusCode: 200, data: { data } });
const unavailable = { statusCode: 503, data: { code: 'FIXTURE_ERROR', message: '暂时不可用' } };
const notFound = { statusCode: 404, data: { code: 'COLLECTION_NOT_FOUND', message: '收藏夹不存在' } };
const tick = () => new Promise(resolve => setImmediate(resolve));
const tap = (id = '', extras = {}) => ({ currentTarget: { dataset: { id, ...extras } }, detail: {} });
const group = (id, name = id) => ({ id, name, version: '0' });
const favorite = (id, collectionIds = [], outputFileId) => ({
    id, resultId: 'result-' + id, collectionIds, outputFileId,
    task: { id: 'design-' + id, title: '设计 ' + id, designType: 'HAIRSTYLE' }
});
const error = (statusCode, code, message) => ({ statusCode, data: { code, message } });

function environment(favorites = [], collections = []) {
    const storage = new Map(), modules = new Map(), calls = [], downloads = [], routes = [];
    const account = id => ({ id, username: null, displayName: null, hasPassword: false, wechatBound: true, avatarFileId: null });
    const state = {
        favorites, collections, account: account('A'), confirm: true,
        intercept: () => undefined, failDownloads: new Set()
    };
    let definition;
    const wx = {
        getStorageSync: key => storage.get(key),
        setStorageSync: (key, value) => storage.set(key, value),
        removeStorageSync: key => storage.delete(key),
        stopPullDownRefresh() {},
        showToast() {},
        showModal: options => Promise.resolve(state.confirm).then(confirm => options.success({ confirm })),
        navigateTo: options => routes.push(options.url),
        reLaunch: options => routes.push(options.url),
        request(options) {
            const url = new URL(options.url);
            const path = url.pathname.replace(/^\/api/, '');
            const call = {
                path, method: options.header['X-HTTP-Method-Override'] || options.method,
                params: url.searchParams, body: options.data
            };
            calls.push(call);
            Promise.resolve().then(() => state.intercept(call) ?? respond(call)).then(options.success, options.fail);
        },
        downloadFile(options) {
            const id = new URL(options.url).pathname.slice(1);
            downloads.push({ id, header: options.header });
            if (state.failDownloads.has(id)) options.fail();
            else options.success({ statusCode: 200, tempFilePath: '/tmp/' + id + '-' + downloads.length });
        }
    };
    function pageResult(items, params) {
        const page = Number(params.get('page'));
        const pageSize = Number(params.get('pageSize'));
        return ok({ page, pageSize, total: items.length, items: structuredClone(items.slice((page - 1) * pageSize, page * pageSize)) });
    }
    function respond({ path, method, params, body }) {
        if (path === '/auth/me') return ok(state.account);
        if (path === '/collections' && method === 'GET') return pageResult(state.collections, params);
        if (path === '/collections' && method === 'POST') {
            const added = group('new', body.name);
            state.collections.unshift(added);
            return ok(added);
        }
        if (path === '/favorites' && method === 'GET') {
            const scope = params.get('collectionId');
            if (scope && !state.collections.some(group => group.id === scope)) return notFound;
            const rows = scope ? state.favorites.filter(item => item.collectionIds.includes(scope)) : state.favorites;
            return pageResult(rows, params);
        }
        const [, resource, id, child, itemId] = path.split('/');
        if (resource === 'files' && child === 'access') {
            assert.equal(body.variant, 'THUMBNAIL');
            return ok({ url: 'https://files.example/' + id });
        }
        if (resource === 'favorites' && method === 'DELETE') {
            state.favorites = state.favorites.filter(item => item.resultId !== id);
            return ok(null);
        }
        if (resource === 'collections') {
            const selected = state.collections.find(group => group.id === id);
            if (!selected) return notFound;
            if (child === 'items') {
                const item = state.favorites.find(item => item.id === itemId);
                item.collectionIds = method === 'PUT' ? [...new Set([...item.collectionIds, id])] : item.collectionIds.filter(group => group !== id);
                return ok(null);
            }
            if (method === 'PATCH') {
                if (body.version !== selected.version) return error(409, 'VERSION_CONFLICT', '收藏夹已修改，请刷新');
                selected.name = body.name;
                selected.version = String(Number(selected.version) + 1);
            }
            if (method === 'DELETE') {
                state.collections = state.collections.filter(group => group.id !== id);
                state.favorites.forEach(item => { item.collectionIds = item.collectionIds.filter(group => group !== id); });
                return ok(null);
            }
            return ok(structuredClone(selected));
        }
        throw Error('Unexpected fixture request: ' + method + ' ' + path);
    }
    function load(url) {
        if (modules.has(url.href)) return modules.get(url.href).exports;
        const module = { exports: {} };
        modules.set(url.href, module);
        const script = ts.transpileModule(readFileSync(url, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
        }).outputText;
        runInNewContext(`(function(require,module,exports){${script}\n})`, {
            wx, Error, Page: page => { definition = page; }
        })(specifier => load(new URL(`${specifier}.ts`, url)), module, module.exports);
        return module.exports;
    }
    const session = load(new URL('lib/session.ts', source));
    const useAccount = id => {
        state.account = account(id);
        session.saveSession({ token: 'fixture-' + id, expiresAt: '2099-01-01T00:00:00Z', account: state.account });
    };
    useAccount('A');
    load(new URL('pages/favorites/index.ts', source));
    const page = {
        ...definition, data: structuredClone(definition.data),
        setData(changes) {
            for (const [key, value] of Object.entries(changes)) {
                const cover = /^items\[(\d+)\]\.cover$/.exec(key);
                if (cover) this.data.items[Number(cover[1])].cover = value;
                else this.data[key] = value;
            }
        }
    };
    page.onLoad();

    return { page, calls, state, useAccount, downloads, routes };
}

test('favorite covers use private thumbnails, survive refresh, and degrade independently', async () => {
    const asset = '90071992547409931';
    const env = environment([favorite('1', [], asset), favorite('2'), favorite('3', [], 'unavailable')]);
    const { page, state, calls, downloads, routes } = env;
    state.failDownloads.add('unavailable');
    await page.refresh();
    assert.deepEqual(Array.from(page.data.items, item => item.typeLabel), ['发型', '发型', '发型']);
    assert.deepEqual(Array.from(page.data.items, item => item.cover), ['/tmp/' + asset + '-1', '', '']);
    assert.deepEqual(downloads.map(value => [value.id, Object.keys(value.header)]), [[asset, []], ['unavailable', []]]);
    assert.equal(page.data.listError, '');
    page.open(tap('2'));
    assert.deepEqual(routes, ['/pages/design-detail/index?id=design-2']);
    const original = page.data.items[0].cover;
    state.favorites = state.favorites.filter(row => row.id !== '2');
    page.onShow();
    await tick();
    assert.equal(page.data.total, 2);
    assert.equal(page.data.items[0].cover, original);
    assert.equal(downloads.filter(value => value.id === asset).length, 1);
    page.imageError(tap('1', { fileId: asset, cover: original }));
    assert.equal(page.data.items[0].cover, '');
    await page.refresh();
    assert.notEqual(page.data.items[0].cover, original);
    page.imageError(tap('1', { fileId: asset, cover: original }));
    assert.ok(page.data.items[0].cover);
    assert.equal(calls.filter(call => call.path === '/files/' + asset + '/access').length, 2);
});

test('pagination failure preserves items, retries the same offset, and stale scope responses are discarded', async () => {
    const env = environment(Array.from({ length: 22 }, (_, i) => favorite(String(i), i === 0 ? ['A'] : i === 21 ? ['B'] : [])), [group('A'), group('B')]);
    const { page, state, calls } = env;
    await page.refresh();
    state.intercept = call => call.path === '/favorites' && call.params.get('page') === '2' ? unavailable : undefined;
    page.onReachBottom();
    await tick();
    assert.equal(page.data.items.length, 20);
    assert.equal(page.data.total, 22);
    assert.match(page.data.listError, /暂时不可用/);
    const callsBefore = calls.length;
    page.onReachBottom();
    await tick();
    assert.equal(calls.length, callsBefore);
    state.intercept = () => undefined;
    await page.retryFavorites();
    assert.equal(page.data.items.length, 22);
    assert.equal(calls.at(-1).params.get('page'), '2');

    let respondOld;
    const stale = new Promise(resolve => { respondOld = resolve; });
    state.intercept = call => {
        if (call.path !== '/favorites') return;
        if (call.params.get('collectionId') === 'A') return stale;
        if (call.params.get('collectionId') === 'B') return unavailable;
    };
    const old = page.filter(tap('A'));
    await tick();
    await page.filter(tap('B'));
    assert.equal(page.data.items.length, 0);
    assert.equal(page.data.collectionId, 'B');
    respondOld(ok({ items: [state.favorites[0]], page: 1, pageSize: 20, total: 1 }));
    await old;
    assert.match(page.data.listError, /暂时不可用/);
    state.intercept = () => undefined;
    await page.retryFavorites();
    assert.deepEqual(Array.from(page.data.items, item => item.id), ['21']);
    assert.equal(calls.at(-1).params.get('page'), '1');
});

test('collection pagination is independent and the selected later folder stays visible after refresh', async () => {
    const env = environment([favorite('1', ['21'])], Array.from({ length: 21 }, (_, index) => group(String(index + 1))));
    const { page, state } = env;
    state.intercept = call => call.path === '/collections' ? unavailable : undefined;
    await page.refresh();
    assert.equal(page.data.items.length, 1);
    assert.equal(page.data.listError, '');
    assert.match(page.data.groupsError, /暂时不可用/);
    state.intercept = () => undefined;
    await page.moreGroups();
    assert.equal(page.data.collections.length, 20);
    await page.moreGroups();
    assert.equal(page.data.collections.length, 21);
    await page.filter(tap('21'));
    await page.refresh();
    assert.equal(page.data.collectionId, '21');
    assert.ok(page.data.filters.some(group => group.id === '21'));
    state.collections = state.collections.filter(group => group.id !== '21');
    await page.refresh();
    assert.equal(page.data.collectionId, '');
    assert.equal(page.data.items.length, 1);
    assert.ok(!page.data.filters.some(group => group.id === '21'));
});

test('collection editing keeps the typed name through conflict and requires explicit resubmission', async () => {
    const env = environment([favorite('1', ['A'])], [group('A', '原收藏夹')]);
    const { page, state, calls } = env;
    await page.refresh();
    page.manage();
    page.edit(tap('A'));
    page.name({ detail: { value: '  我的改名  ' } });
    state.collections[0].version = '2';
    state.collections[0].name = '另端收藏夹';
    await page.saveGroup();
    assert.equal(page.data.sheet, 'edit');
    assert.equal(page.data.groupName, '  我的改名  ');
    assert.equal(page.data.versionConflict, true);
    await page.saveGroup();
    assert.equal(calls.filter(call => call.method === 'PATCH').length, 1);
    await page.reloadGroupVersion();
    assert.equal(page.data.editingVersion, '2');
    assert.equal(page.data.latestName, '另端收藏夹');
    assert.equal(page.data.groupName, '  我的改名  ');
    await page.saveGroup();
    assert.equal(page.data.sheet, 'groups');
    assert.equal(page.data.collections[0].name, '我的改名');
    assert.equal(calls.filter(call => call.method === 'PATCH').at(-1).body.version, '2');
    page.edit(tap());
    page.name({ detail: { value: '旅行' } });
    await page.saveGroup();
    assert.equal(page.data.collections[0].name, '旅行');
    page.close();
    await page.filter(tap('A'));
    page.manage();
    state.confirm = false;
    await page.deleteGroup(tap('A'));
    assert.equal(page.data.collectionId, 'A');
    state.confirm = true;
    await page.deleteGroup(tap('A'));
    assert.equal(page.data.collectionId, '');
    assert.equal(page.data.items.length, 1);
    assert.equal(page.data.items[0].collectionIds.length, 0);
});

test('membership writes update only after success and removing from the displayed folder repairs page offsets', async () => {
    const env = environment(Array.from({ length: 22 }, (_, i) => favorite(String(i), ['A'])), [group('A'), group('B')]);
    const { page, state, calls } = env;
    await page.refresh();
    await page.filter(tap('A'));
    page.menu(tap('0'));
    page.showMembership();
    state.intercept = call => call.method === 'PUT' ? unavailable : undefined;
    await page.membership(tap('B'));
    assert.equal(page.data.groupChoices.find(item => item.id === 'B').included, false);
    assert.match(page.data.writeError, /暂时不可用/);
    state.intercept = () => undefined;
    await page.membership(tap('B'));
    assert.equal(page.data.groupChoices.find(item => item.id === 'B').included, true);
    await page.membership(tap('A'));
    assert.equal(page.data.groupChoices.find(item => item.id === 'A').included, false);
    assert.equal(page.data.total, 21);
    assert.deepEqual(Array.from(page.data.items.slice(0, 2), item => item.id), ['1', '2']);
    assert.equal(calls.at(-1).params.get('page'), '1');
    page.close();
    page.onReachBottom();
    await tick();
    assert.equal(page.data.items.length, 21);
    assert.equal(page.data.items.at(-1).id, '21');
    await page.filter(tap('B'));
    assert.deepEqual(Array.from(page.data.items, item => item.id), ['0']);
    page.menu(tap('0'));
    state.confirm = false;
    await page.unfavorite();
    assert.equal(page.data.items.length, 1);
    state.confirm = true;
    await page.unfavorite();
    assert.equal(page.data.sheet, '');
    assert.equal(page.data.items.length, 0);
    assert.equal(page.data.total, 0);
    assert.equal(calls.filter(call => call.path.startsWith('/favorites/') && call.method === 'DELETE').length, 1);
});

test('late favorite responses cannot reverse a successful membership change or cross accounts', async () => {
    const env = environment(Array.from({ length: 21 }, (_, i) => favorite(String(i))), [group('A')]);
    const { page, state, useAccount, calls, routes } = env;
    await page.refresh();
    page.menu(tap('0'));
    page.showMembership();
    let resolve;
    const stale = new Promise(done => { resolve = done; });
    state.intercept = call => call.path === '/favorites' && call.params.get('page') === '2' ? stale : undefined;
    const read = page.loadFavorites(false);
    await tick();
    await page.membership(tap('A'));
    resolve(ok({ items: [favorite('0'), favorite('20')], page: 2, pageSize: 20, total: 21 }));
    await read;
    assert.deepEqual(Array.from(page.data.items[0].collectionIds), ['A']);
    page.close();
    page.menu(tap('0'));
    let confirm;
    state.confirm = new Promise(done => { confirm = done; });
    const action = page.unfavorite();
    useAccount('B');
    confirm(true);
    await action;
    assert.equal(calls.filter(call => call.path === '/favorites/result-0' && call.method === 'DELETE').length, 0);
    await page.refresh();
    assert.deepEqual(routes, ['/pages/home/index']);
});
