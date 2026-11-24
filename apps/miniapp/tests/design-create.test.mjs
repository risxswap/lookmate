import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = new URL('../src/', import.meta.url);
const editor = new URL('pages/design-create/index.ts', source);
const tap = (id, value) => ({ currentTarget: { dataset: { id } }, detail: { value } });
const ok = data => ({ statusCode: 200, data: { data } });
const rejection = (code, message, statusCode = 409) => ({ statusCode, data: { code, message } });
const portrait = { id: '1', fileId: 'portrait', photoType: 'PORTRAIT' };
const fullBody = { id: '2', fileId: 'full-body', photoType: 'FULL_BODY' };
const dress = id => ({ id, name: '衣物 ' + id, images: [] });
const reference = { id: '9', name: '自然短碎发', version: '3', availability: 'AVAILABLE', images: [{ url: 'https://example.invalid/reference', angle: 'FRONT' }] };

function environment() {
    const account = { id: 'A' };
    const stored = new Map();
    const modules = new Map();
    const calls = [], navigation = [], scrolled = [], titles = [];
    let pageDefinition;
    let intercept = () => undefined;
    let photos = { portrait, fullBody, angles: {} };
    let preview = { canSubmit: true, previewToken: 'preview', expiresAt: '2099-01-01', requiredDresses: [], notices: [], restrictions: [], conflicts: [] };
    const pages = { 1: [dress('21')], 2: [dress('22')] };
    const wx = {
        getStorageSync: key => stored.get(key),
        setStorageSync: (key, value) => stored.set(key, structuredClone(value)),
        removeStorageSync: key => stored.delete(key),
        setNavigationBarTitle: opts => titles.push(opts.title),
        hideKeyboard() {},
        nextTick: queueMicrotask,
        stopPullDownRefresh() {},
        pageScrollTo: opts => scrolled.push(opts.selector),
        reLaunch: opts => navigation.push(opts.url),
        redirectTo: opts => navigation.push(opts.url),
        getUserCryptoManager: () => ({ getRandomValues: options => options.success({ randomValues: new Uint8Array(16).fill(7).buffer }) }),
        request(options) {
            const url = new URL(options.url);
            const call = { method: options.method, path: url.pathname.slice(4), params: url.searchParams, body: options.data, headers: options.header };
            calls.push(call);
            Promise.resolve().then(() => intercept(call) ?? respond(call)).then(options.success, options.fail);
        }
    };
    function respond(call) {
        const { path, method, params } = call;
        if (path === '/auth/me') return ok(account);
        if (path === '/profile') return ok({ id: 'A', version: '6', currentMeasurementId: 'current' });
        if (path === '/photos/slots') return ok(photos);
        if (path.startsWith('/files/')) return ok({ url: 'https://example.invalid' + path });
        if (path === '/hairstyles/9') return ok(reference);
        if (path === '/dresses/22') return ok(dress('22'));
        if (path === '/dresses') {
            const page = Number(params.get('page'));
            return ok({ page, pageSize: 20, total: 21, items: pages[page] });
        }
        if (path === '/designs/preview') return ok(preview);
        if (path.startsWith('/designs/by-request/') || (path === '/designs' && method === 'POST')) return ok({ taskId: 'task-1' });
        throw Error('Unexpected request to ' + path);
    }
    function load(url) {
        if (modules.has(url.href)) return modules.get(url.href).exports;
        const module = { exports: {} };
        modules.set(url.href, module);
        const script = ts.transpileModule(readFileSync(url, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
        }).outputText;
        runInNewContext(`(function(require,module,exports){${script}\n})`, {
            wx, Error, Date, Uint8Array, Page: definition => { pageDefinition = definition; }
        })(specifier => load(new URL(`${specifier}.ts`, url)), module, module.exports);
        return module.exports;
    }
    const session = load(new URL('lib/session.ts', source));
    session.saveSession({ account, token: 'test-token', expiresAt: '2099-01-01' });
    const storage = load(new URL('lib/storage.ts', source));
    load(editor);
    const page = { ...pageDefinition, data: structuredClone(pageDefinition.data), setData(values) { Object.assign(this.data, values); } };
    return {
        page, calls, navigation, scrolled, titles, storage,
        get writes() { return calls.filter(call => call.path === '/designs' && call.method === 'POST'); },
        get checks() { return calls.filter(call => call.path === '/designs/preview'); },
        get dressPages() { return calls.filter(call => call.path === '/dresses').map(call => call.params.get('page')); },
        set intercept(handler) { intercept = handler; },
        set photos(value) { photos = value; },
        set preview(value) { preview = { ...preview, ...value }; }
    };
}

test('reference and visible form fields carry into review, cancel without posting, and submit once on confirmation', async () => {
    const env = environment();
    const { page } = env;
    env.storage.saveDraft('HAIRSTYLE', { occasion: '约会' });
    env.storage.saveDraft('OUTFIT', { style: '简约' });
    await page.onLoad({ mode: 'HAIRSTYLE', referenceId: '9', referenceVersion: '3' });
    assert.deepEqual(env.titles, ['发型设计']);
    assert.equal(page.data.reference.name, '自然短碎发');
    assert.equal(page.data.reference.url, reference.images[0].url);
    assert.equal(page.data.input.occasion, '约会');
    assert.equal(page.data.input.style, '');
    assert.equal(page.data.input.personFileId, 'portrait');
    page.field(tap('style', '自然'));
    page.photo(tap('full-body'));
    await page.submit();
    assert.equal(env.writes.length, 0);
    await page.preview();
    assert.equal(page.data.reviewOpen, true);
    assert.equal(page.data.reviewPhoto.fileId, 'full-body');
    assert.equal(env.checks[0].body.hairstyleVersion, '3');
    assert.equal(env.writes.length, 0);
    page.closeReview({ detail: { visible: false } });
    await page.submit();
    assert.equal(env.writes.length, 0);
    assert.equal(env.storage.readDraft('HAIRSTYLE').style, '自然');

    await page.preview();
    await Promise.all([page.submit(), page.submit()]);
    assert.equal(env.writes.length, 1);
    assert.equal(env.writes[0].body.input.style, '自然');
    assert.equal(env.writes[0].body.input.hairstyleId, '9');
    assert.equal(env.writes[0].body.previewToken, 'preview');
    assert.ok(env.writes[0].headers['Idempotency-Key']);
    assert.deepEqual(env.navigation, ['/pages/design-detail/index?id=task-1']);
    page.onUnload();
    assert.equal(env.storage.readDraft('HAIRSTYLE'), null);
    assert.equal(env.storage.readDraft('OUTFIT').style, '简约');
});

test('pregeneration conflicts can be overridden and unknown submission can be looked up with its original key', async () => {
    const env = environment();
    const { page } = env;
    await page.onLoad({ referenceId: '9', referenceVersion: '3' });
    page.hairColor(tap('', true));
    env.preview = {
        canSubmit: false, previewToken: null, conflicts: [{ restrictionId: 'DYE_REJECT', message: '仅本次允许参考发色？' }],
        restrictions: [{ id: 'DYE_REJECT', text: '不染发', overridden: false }]
    };
    await page.preview();
    assert.equal(page.data.reviewOpen, false);
    assert.equal(env.scrolled.at(-1), '#design-check');
    page.override(tap('', ['DYE_REJECT']));
    assert.equal(page.data.overrideOptions[0].checked, true);
    env.preview = { canSubmit: true, previewToken: 'next', conflicts: [] };
    await page.preview();
    assert.deepEqual(Array.from(env.checks.at(-1).body.constraintOverrides), ['DYE_REJECT']);

    env.intercept = call => {
        if (call.path === '/designs') throw new Error('offline');
    };
    await page.submit();
    assert.equal(page.data.reviewOpen, false);
    assert.equal(env.scrolled.at(-1), '#design-pending');
    const key = page.data.pending.key;
    assert.equal(key, env.writes[0].headers['Idempotency-Key']);
    assert.ok(env.storage.readDraft('HAIRSTYLE'));
    page.field(tap('requirements', '第二版尚未提交'));
    await page.recover(tap(''));
    page.onUnload();
    assert.equal(env.storage.readDraft('HAIRSTYLE').requirements, '第二版尚未提交');
    assert.equal(env.calls.at(-1).path, '/designs/by-request/' + key);
    assert.equal(env.writes.length, 1);
    assert.equal(page.data.pending, null);
});

test('an expired review closes without a generated task and retains the draft', async () => {
    const env = environment();
    const { page } = env;
    await page.onLoad({ mode: 'OVERALL' });
    assert.deepEqual(env.titles, ['整体设计']);
    page.field(tap('requirements', '不要换发色'));
    env.preview = { expiresAt: '2000-01-01' };
    await page.preview();
    await page.submit();
    assert.equal(env.writes.length, 0);
    assert.equal(page.data.reviewOpen, false);
    assert.equal(page.data.issue.area, 'check');
    assert.match(page.data.issue.message, /过期/);
    assert.equal(env.storage.readDraft('OVERALL').requirements, '不要换发色');
});

test('clothing selection restores a saved item, loads lazily and retries the failed server page', async () => {
    const env = environment();
    const { page } = env;
    env.storage.saveDraft('OUTFIT', { requiredDressIds: ['22'] });
    await page.onLoad({ mode: 'OUTFIT' });
    assert.equal(page.data.selectedDresses[0].name, '衣物 22');
    assert.deepEqual(env.dressPages, []);
    await page.toggleDresses();
    assert.deepEqual(env.dressPages, ['1']);
    page.dress(tap('21'));
    assert.deepEqual(Array.from(page.data.input.requiredDressIds), ['22', '21']);

    env.intercept = call => call.path === '/dresses' && rejection('UNAVAILABLE', '加载失败', 503) || undefined;
    await page.moreDresses();
    assert.equal(page.data.dressError, '加载失败');
    assert.equal(page.data.dresses.length, 1);
    env.intercept = () => undefined;
    await page.moreDresses();
    assert.deepEqual(env.dressPages, ['1', '2', '2']);
    assert.equal(page.data.dresses[1].selected, true);
    assert.equal(page.data.dressMore, false);

    env.intercept = call => call.path === '/dresses' && rejection('UNAVAILABLE', '刷新失败', 503) || undefined;
    await page.load();
    assert.equal(page.data.dressError, '刷新失败');
    env.intercept = () => undefined;
    await page.moreDresses();
    assert.deepEqual(env.dressPages, ['1', '2', '2', '1', '1']);
    page.removeDress(tap('22'));
    await page.toggleDresses();
    assert.deepEqual(Array.from(page.data.input.requiredDressIds), ['21']);
    assert.equal(page.data.dressesOpen, false);
    assert.equal(page.data.selectedDresses[0].id, '21');
});

test('missing photos show a section error and reference load failure preserves the selection for validation', async () => {
    const env = environment();
    const { page } = env;
    env.photos = { portrait: null, fullBody: null, angles: {} };
    env.intercept = call => call.path === '/hairstyles/9' && rejection('HAIRSTYLE_UNAVAILABLE', '下架', 404) || undefined;
    await page.onLoad({ referenceId: '9', referenceVersion: '3' });
    assert.equal(page.data.reference.name, '发型参考');
    assert.equal(page.data.input.hairstyleId, '9');
    assert.equal(env.storage.readDraft('HAIRSTYLE').hairstyleId, '9');
    await page.preview();
    assert.equal(env.checks.length, 0);
    assert.equal(env.scrolled.at(-1), '#design-photo');
    assert.equal(page.data.issue.area, 'photo');
    page.clearReference();
    assert.equal(page.data.reference, null);
    assert.equal(env.storage.readDraft('HAIRSTYLE').hairstyleId, null);
});
