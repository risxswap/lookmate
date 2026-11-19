import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = new URL('../src/', import.meta.url);
const editorPath = 'pages/measurements/index';
const historyPath = 'pages/measurement-history/index';
const tap = (id = '') => ({ currentTarget: { dataset: { id } }, detail: {} });
const field = (page, key) => page.data.groups.flatMap(group => group.fields).find(field => field.key === key).value;
const setField = (page, key, value) => page.field({ ...tap(key), detail: { value } });
const ok = data => ({ statusCode: 200, data: { data } });
const conflict = { statusCode: 409, data: { code: 'VERSION_CONFLICT', message: '资料已更新，请刷新' } };
const record = (id, height = 170) => ({ id, height, weight: 60, createdAt: '2026-11-18T12:00:00Z', waist: 75 });
const defer = () => {
    let resolve;
    const promise = new Promise(res => { resolve = res; });
    return { resolve, promise };
};

function eventChannel() {
    const queued = new Map(), listeners = new Map();
    return {
        once(name, listen) {
            if (queued.has(name)) {
                const data = queued.get(name);
                queued.delete(name);
                listen(data);
            } else listeners.set(name, listen);
        },
        off(name, listen) {
            if (listeners.get(name) === listen) listeners.delete(name);
        },
        emit(name, data) {
            const listen = listeners.get(name);
            if (!listen) queued.set(name, data);
            else {
                listeners.delete(name);
                listen(data);
            }
        }
    };
}

function environment() {
    const modules = new Map(), definitions = new Map(), stored = new Map();
    const calls = [], modals = [], menus = [], navigation = [];
    let account = { id: 'A' };
    let profile = { id: 'A', version: '9', gender: 'MALE', currentMeasurementId: 'current', currentMeasurement: record('current') };
    let records = [record('history-2'), record('history-1', 163)];
    let intercept = () => undefined;
    let answer = true;
    let choose = () => 0;
    let history, loaded;
    const wx = {
        getStorageSync: key => stored.get(key),
        setStorageSync: (key, value) => stored.set(key, value),
        removeStorageSync: key => stored.delete(key),
        showModal: options => { modals.push(options.content); options.success?.({ confirm: answer }); },
        showActionSheet(options) {
            menus.push(options.itemList);
            Promise.resolve(choose()).then(tapIndex => tapIndex == null ? options.fail() : options.success({ tapIndex }));
        },
        showToast: () => {},
        stopPullDownRefresh: () => navigation.push('stopped pull-to-refresh'),
        pageScrollTo: () => navigation.push('scrolled'),
        reLaunch: options => navigation.push(options.url),
        navigateTo(options) {
            navigation.push(options.url);
            const channel = eventChannel();
            editor.onHide();
            // Delivery before onLoad exercises queued native channel emissions.
            options.success({ eventChannel: channel });
            history = makePage(historyPath, channel);
            loaded = history.onLoad();
            history.onShow();
            options.complete();
        },
        request(options) {
            const url = new URL(options.url);
            const call = { method: options.header['X-HTTP-Method-Override'] ?? options.method, path: url.pathname.replace(/^\/api/, ''), params: url.searchParams, body: options.data };
            calls.push(call);
            Promise.resolve().then(() => intercept(call) ?? respond(call)).then(options.success, options.fail);
        }
    };
    function respond({ method, path, params, body }) {
        if (method === 'GET') {
            if (path === '/auth/me') return ok(account);
            if (path === '/profile') return ok(profile);
            if (path === '/profile/measurements') {
                const page = Number(params.get('page'));
                const pageSize = Number(params.get('pageSize'));
                return ok({ page, pageSize, total: records.length, items: records.slice((page - 1) * pageSize, page * pageSize) });
            }
        }
        if (body?.version !== profile.version) return conflict;
        const version = String(BigInt(profile.version) + 1n);
        if (method === 'DELETE') {
            records = records.filter(item => path !== `/profile/measurements/${item.id}`);
            profile = { ...profile, version };
            return ok(null);
        }
        if (method === 'PUT') {
            const currentMeasurement = body.measurementId ? { ...records.find(item => item.id === body.measurementId), id: 'current' } : null;
            profile = { ...profile, version, currentMeasurement, currentMeasurementId: currentMeasurement?.id ?? null };
            return ok(profile);
        }
        if (method === 'PATCH' || method === 'POST') {
            const currentMeasurement = { ...record('current'), ...body };
            profile = { ...profile, version, currentMeasurement, currentMeasurementId: 'current' };
            return ok(profile);
        }
        throw Error(`Unexpected ${method} ${path}`);
    }
    function load(url) {
        if (modules.has(url.href)) return modules.get(url.href).exports;
        const module = { exports: {} };
        modules.set(url.href, module);
        const script = ts.transpileModule(readFileSync(url, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
        }).outputText;
        runInNewContext(`(function(require,module,exports){${script}\n})`, {
            wx, Error, Page: definition => definitions.set(url.href, definition)
        })(specifier => load(new URL(`${specifier}.ts`, url)), module, module.exports);
        return module.exports;
    }
    function makePage(path, channel = {}) {
        const url = new URL(`${path}.ts`, source);
        load(url);
        const definition = definitions.get(url.href);
        return {
            ...definition, data: structuredClone(definition.data), getOpenerEventChannel: () => channel,
            setData(values) { Object.assign(this.data, values); }
        };
    }
    const editor = makePage(editorPath);
    const session = load(new URL('lib/session.ts', source));
    const switchAccount = id => {
        account = { id };
        session.saveSession({ account, token: `test-session-${id}`, expiresAt: '2099-01-01T00:00:00Z' });
    };
    switchAccount('A');
    return {
        editor, calls, modals, menus, navigation, switchAccount,
        get writes() { return calls.filter(call => call.method !== 'GET'); },
        get pages() { return calls.filter(call => call.method === 'GET' && call.path === '/profile/measurements').map(call => [...call.params.values()]); },
        set profile(value) { profile = { ...profile, ...value }; },
        set records(value) { records = value; },
        set intercept(value) { intercept = value; },
        set answer(value) { answer = value; },
        set choose(value) { choose = value; },
        respond,
        async open() { editor.openHistory(); await loaded; return history; },
        back() { history.onUnload(); editor.onShow(); }
    };
}

function dirtyEditor(editor) {
    editor.toggle(tap('躯干'));
    setField(editor, 'height', '178.25');
}

function assertDraft(editor) {
    assert.equal(field(editor, 'height'), '178.25');
    assert.equal(editor.data.groups.find(group => group.title === '躯干').open, true);
}

function assertWrite(call, method, path, body) {
    assert.equal(call.method, method);
    assert.equal(call.path, path);
    assert.deepEqual(structuredClone(call.body), body);
}

function useRecord(history, recordId) {
    history.openDetail(tap(recordId));
    return history.useSelected(tap(recordId));
}

function deleteRecord(history, recordId) {
    history.openDetail(tap(recordId));
    return history.detailMenu(tap(recordId));
}

test('editor enters the registered history page; read-only browse/back retains the exact form and makes no writes or reloads', async () => {
    const env = environment();
    const { editor } = env;
    await editor.onLoad();
    assert.equal(env.pages.length, 0);
    dirtyEditor(editor);
    const groups = editor.data.groups;
    const history = await env.open();
    assert.deepEqual(env.navigation, [`/${historyPath}`]);
    assert.deepEqual(env.pages, [['1', '20']]);
    assert.equal(history.data.total, 2);
    assert.deepEqual(structuredClone(history.data.currentFields.map(({ value, unit }) => `${value} ${unit}`)), ['170 cm', '60 kg', '75 cm']);
    assert.equal(history.data.items[0].id, 'history-2');
    // This history has identical values to the current copy; it is not a persisted source.
    assert.equal('current' in history.data.items[0], false);
    history.openDetail(tap('history-2'));
    assert.equal(history.data.detailVisible, true);
    assert.equal(history.data.detail.id, 'history-2');
    assert.equal(history.data.detail.date, history.data.items[0].date);
    assert.equal(history.data.detail.groups.flatMap(group => group.fields).length, 27);
    history.detailVisibilityChanged({ detail: { visible: false } });
    assert.equal(history.data.detailVisible, false);
    history.openDetail(tap('history-1'));
    assert.equal(history.data.detail.id, 'history-1');
    history.closeDetail();
    assert.equal(history.data.detailVisible, false);
    assert.ok(!env.navigation.includes('scrolled'));
    const callsBeforeBack = env.calls.length;
    env.back();
    assert.equal(env.calls.length, callsBeforeBack);
    assert.deepEqual(env.navigation, [`/${historyPath}`]);
    assert.equal(editor.data.groups, groups);
    assertDraft(editor);
    assert.equal(env.writes.length, 0);
});

test('current size and history summaries prioritize filled height, weight and waist, then follow field order', async () => {
    const env = environment();
    const sparse = { ...record('sparse'), height: null, weight: null, waist: null, neck: 32.25, chest: 88, hip: 91, wrist: 16 };
    env.profile = { currentMeasurement: sparse };
    env.records = [{ ...record('normal'), neck: 35 }, sparse, { ...record('empty'), height: null, weight: null, waist: null }];
    await env.editor.onLoad();
    const history = await env.open();
    assert.equal(history.data.currentCount, 4);
    assert.deepEqual(structuredClone(history.data.currentFields.map(field => field.key)), ['neck', 'chest', 'hip']);
    assert.equal(history.data.items[0].summary, '身高 170 cm · 体重 60 kg · 腰围 75 cm');
    assert.equal(history.data.items[1].summary, '颈围 32.25 cm · 胸围 88 cm · 臀围 91 cm');
    assert.equal(history.data.items[2].summary, '未填写尺寸');
    history.openDetail(tap('sparse'));
    const fields = history.data.detail.groups.flatMap(group => group.fields);
    assert.equal(fields.find(field => field.key === 'height').text, '未填');
    assert.equal(fields.find(field => field.key === 'neck').text, '32.25 cm');
});

test('cancelled menus and stale detail actions make no writes or confirmation prompts', async () => {
    const env = environment();
    await env.editor.onLoad();
    const history = await env.open();
    env.choose = () => null;
    await history.currentMenu();
    await deleteRecord(history, 'history-1');
    assert.deepEqual(structuredClone(env.menus), [['暂不使用尺寸'], ['删除记录']]);
    assert.equal(history.data.detailVisible, true);
    assert.equal(history.data.detail.id, 'history-1');

    const selection = defer();
    env.choose = () => selection.promise;
    const pending = history.detailMenu(tap('history-1'));
    history.closeDetail();
    history.openDetail(tap('history-2'));
    selection.resolve(0);
    await pending;
    await history.useSelected(tap('history-1'));
    assert.equal(history.data.detail.id, 'history-2');
    assert.equal(env.modals.length, 0);
    assert.equal(env.writes.length, 0);
});

test('pagination uses returned total and retries the failed page without discarding previous records', async () => {
    const env = environment();
    env.records = Array.from({ length: 21 }, (_, index) => record(`history-${21 - index}`));
    await env.editor.onLoad();
    const history = await env.open();
    assert.equal(history.data.items.length, 20);
    assert.equal(history.data.total, 21);
    const first = history.data.items;
    env.intercept = call => call.params.get('page') === '2' ? Promise.reject(Error('offline')) : undefined;
    await history.more();
    assert.match(history.data.listError, /网络连接失败/);
    assert.equal(history.data.items, first);
    env.intercept = () => undefined;
    await history.retryList();
    assert.deepEqual(env.pages, [['1', '20'], ['2', '20'], ['2', '20']]);
    assert.equal(history.data.items.length, 21);
    assert.equal(history.data.items[20].id, 'history-1');
    assert.equal(history.data.hasMore, false);
    assert.equal(history.data.listError, '');
});

test('pull-to-refresh failures keep loaded rows, retry page one, and a server empty result is not an error', async () => {
    const env = environment();
    await env.editor.onLoad();
    const history = await env.open();
    env.records = [];
    env.intercept = call => call.path === '/profile/measurements' ? Promise.reject(Error('offline')) : undefined;
    await history.onPullDownRefresh();
    assert.equal(history.data.items.length, 2);
    assert.match(history.data.listError, /网络连接失败/);
    assert.ok(env.navigation.includes('stopped pull-to-refresh'));
    env.intercept = () => undefined;
    await history.retryList();
    assert.deepEqual(env.pages, [['1', '20'], ['1', '20'], ['1', '20']]);
    assert.equal(history.data.loaded, true);
    assert.equal(history.data.items.length, 0);
    assert.equal(history.data.listError, '');
});

for (const [label, target] of [['use', 'history-1'], ['clear', null]]) {
    test(`${label}: dirty cancellation and rejected write preserve the draft; confirmed success uses the returned Profile`, async () => {
        const env = environment();
        await env.editor.onLoad();
        dirtyEditor(env.editor);
        const history = await env.open();
        const apply = () => target ? useRecord(history, target) : history.currentMenu();
        env.answer = false;
        await apply();
        assert.match(env.modals[0], /未保存的输入/);
        assert.equal(env.writes.length, 0);
        assertDraft(env.editor);
        env.answer = true;
        env.intercept = call => call.method === 'PUT' ? conflict : undefined;
        await apply();
        assert.equal(env.writes.length, 1);
        assert.match(history.data.error, /资料已更新/);
        assert.equal(env.editor.data.profile.version, '9');
        assertDraft(env.editor);
        env.intercept = () => undefined;
        await apply();
        assert.equal(env.modals.length, 3);
        assert.equal(env.writes.length, 2);
        assertWrite(env.writes[1], 'PUT', '/profile/current-measurement', { version: '9', measurementId: target });
        assert.equal(env.editor.data.profile.version, '10');
        assert.equal(env.editor.data.profile.currentMeasurementId, target ? 'current' : null);
        assert.equal(field(env.editor, 'height'), target ? '163' : '');
        assert.equal(env.editor.data.groups.find(group => group.title === '躯干').open, true);
        assert.equal(history.data.items.length, 2);
        assert.equal(history.data.currentFields[0]?.value, target ? 163 : undefined);
        env.back();
        assert.ok(!env.navigation.includes('scrolled'));
    });
}

test('deleting after confirmation uses the exact successor version, never changes the draft, and re-paginates', async () => {
    const env = environment();
    env.profile = { version: '9007199254740999' };
    await env.editor.onLoad();
    dirtyEditor(env.editor);
    const history = await env.open();
    env.answer = false;
    await deleteRecord(history, 'history-1');
    assert.equal(env.writes.length, 0);
    assert.equal(history.data.detailVisible, true);
    env.answer = true;
    await deleteRecord(history, 'history-1');
    assertWrite(env.writes[0], 'DELETE', '/profile/measurements/history-1', { version: '9007199254740999' });
    assert.equal(history.data.profile.version, '9007199254741000');
    assert.equal(env.editor.data.profile.version, '9007199254741000');
    assert.equal(env.editor.data.profile.currentMeasurementId, 'current');
    assert.equal(history.data.detailVisible, false);
    assert.equal(history.data.total, 1);
    assert.deepEqual(env.pages, [['1', '20'], ['1', '20']]);
    assertDraft(env.editor);
    env.back();
    await env.editor.save({ currentTarget: { dataset: { mode: 'current' } } });
    assert.equal(env.writes[1].body.version, '9007199254741000');
    assert.equal(env.writes[1].body.height, 178.25);
    assert.equal(env.editor.data.profile.version, '9007199254741001');
});

test('delete cannot advance an opener across a prior unrelated profile edit', async () => {
    const env = environment();
    await env.editor.onLoad();
    dirtyEditor(env.editor);
    env.profile = { version: '10', gender: 'FEMALE' };
    const history = await env.open();
    await deleteRecord(history, 'history-1');
    assert.equal(history.data.profile.version, '11');
    assert.equal(env.editor.data.profile.version, '9');
    assertDraft(env.editor);
    env.back();
    await env.editor.save({ currentTarget: { dataset: { mode: 'new' } } });
    assert.equal(env.writes[1].body.version, '9');
    assert.match(env.editor.data.error, /资料已更新/);
    assertDraft(env.editor);
});

test('failed DELETE preserves records, current size and draft without bumping either version', async () => {
    const env = environment();
    await env.editor.onLoad();
    dirtyEditor(env.editor);
    const history = await env.open();
    env.intercept = call => call.method === 'DELETE' ? conflict : undefined;
    await deleteRecord(history, 'history-1');
    assert.equal(history.data.profile.version, '9');
    assert.equal(env.editor.data.profile.version, '9');
    assert.equal(history.data.items.length, 2);
    assert.equal(history.data.detailVisible, true);
    assertDraft(env.editor);
    assert.match(history.data.error, /资料已更新/);
    assert.equal(env.writes.length, 1);
});

for (const [operation, run] of [['use', useRecord], ['remove', deleteRecord]]) {
    test(`pending ${operation} after native Back settles on the original opener without reloading`, async () => {
        const env = environment();
        await env.editor.onLoad();
        dirtyEditor(env.editor);
        const history = await env.open();
        const sent = defer(), settle = defer();
        env.intercept = call => {
            if (call.method === 'GET') return;
            sent.resolve(call);
            return settle.promise;
        };
        const pending = run(history, 'history-1');
        const call = await sent.promise;
        assert.equal(env.editor.data.historyWriting, true);
        env.back();
        setField(env.editor, 'height', '185');
        await env.editor.save({ currentTarget: { dataset: { mode: 'current' } } });
        assertDraft(env.editor);
        assert.equal(env.writes.length, 1);
        const requestCount = env.calls.length;
        settle.resolve(env.respond(call));
        await pending;
        assert.equal(env.calls.length, requestCount);
        assert.equal(history.data.profile.version, '9');
        assert.equal(env.editor.data.profile.version, '10');
        assert.equal(env.editor.data.historyWriting, false);
        assert.equal(field(env.editor, 'height'), operation === 'use' ? '163' : '178.25');
        assert.equal(env.editor.data.groups.find(group => group.title === '躯干').open, true);
    });
}

test('failed write after Back unlocks the editor without replacing the draft', async () => {
    const env = environment();
    await env.editor.onLoad();
    dirtyEditor(env.editor);
    const history = await env.open();
    const sent = defer(), settle = defer();
    env.intercept = call => { if (call.method === 'PUT') { sent.resolve(); return settle.promise; } };
    const pending = useRecord(history, 'history-1');
    await sent.promise;
    env.back();
    settle.resolve(conflict);
    await pending;
    assert.equal(env.editor.data.historyWriting, false);
    assert.equal(env.editor.data.profile.version, '9');
    assertDraft(env.editor);
});

test('late result and subsequent actions cannot cross a switched account', async () => {
    const env = environment();
    await env.editor.onLoad();
    dirtyEditor(env.editor);
    const history = await env.open();
    const sent = defer(), settle = defer();
    env.intercept = call => { if (call.method === 'PUT') { sent.resolve(call); return settle.promise; } };
    const pending = useRecord(history, 'history-1');
    const call = await sent.promise;
    env.switchAccount('B');
    settle.resolve(env.respond(call));
    await pending;
    await deleteRecord(history, 'history-2');
    assert.equal(env.writes.length, 1);
    assert.equal(env.editor.data.profile.version, '9');
    assertDraft(env.editor);
    assert.ok(env.navigation.includes('/pages/home/index'));
});

test('history template has a TDesign row action and a bottom sheet with independently scrolling read-only fields', () => {
    const template = readFileSync(new URL(`${historyPath}.wxml`, source), 'utf8');
    const editor = readFileSync(new URL(`${editorPath}.wxml`, source), 'utf8');
    const app = JSON.parse(readFileSync(new URL('app.json', source), 'utf8'));
    assert.ok(app.pages.includes(historyPath));
    assert.match(template, /<t-button[^>]+t-class="lm-custom-root"[^>]+block[^>]+bind:tap="openDetail"[^>]+aria-label=/);
    assert.match(template, /<t-popup[^>]+placement="bottom"[^>]+prevent-scroll-through/);
    assert.match(template, /<scroll-view[^>]+scroll-y>[\s\S]*wx:for="{{detail.groups}}"[\s\S]*<\/scroll-view>[\s\S]*bind:tap="useSelected">使用此记录/);
    assert.match(template, /bind:tap="currentMenu"/);
    assert.match(template, /bind:tap="detailMenu"/);
    assert.doesNotMatch(template, /<button\b|当前使用/);
    assert.match(editor, /bind:tap="openHistory">尺寸历史/);
    assert.doesNotMatch(editor, /历史记录|bind:tap="remove"/);
    assert.match(editor, /bind:tap="openGuide"/);
});
