import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = new URL('../src/', import.meta.url);
const pageName = 'pages/measurements/index';
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const readImage = guide => readFileSync(new URL(guide.image.slice(1), source));
const tap = id => ({ currentTarget: { dataset: { id } } });

function environment(gender = null) {
    const account = { id: 'local-account' };
    const measurement = { id: 'record-1', current: true, height: 165 };
    const profile = { id: account.id, gender, version: '3', currentMeasurementId: measurement.id, currentMeasurement: measurement };
    const calls = [];
    const keyboardCallbacks = [];
    const modules = new Map();
    let page;
    const substitutes = {
        'lib/auth.ts': { getAccount: () => account, requireAccount: async () => account },
        'lib/api.ts': {
            api: {
                profile: async () => { calls.push({ path: '/profile' }); return profile; }
            }
        },
        'lib/request.ts': { request: async (path, options) => { calls.push({ path, ...options }); } }
    };
    const wx = {
        hideKeyboard: options => keyboardCallbacks.push(options.complete),
        showModal: options => options.success({ confirm: true }),
        showToast: () => {},
        pageScrollTo: options => { calls.push({ path: 'wx.pageScrollTo', options }); },
        navigateTo: options => { calls.push({ path: 'wx.navigateTo', options }); }
    };
    function load(name) {
        const url = new URL(name, source);
        if (modules.has(url.href)) return modules.get(url.href).exports;
        const substitute = substitutes[url.href.slice(source.href.length)];
        if (substitute) return substitute;
        const module = { exports: {} };
        modules.set(url.href, module);
        const js = ts.transpileModule(readFileSync(url, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
        }).outputText;
        runInNewContext(`(function(require,module,exports){${js}\n})`, {
            wx, Page: definition => { page = { ...definition, setData: values => Object.assign(definition.data, values) }; }
        })(specifier => load(new URL(`${specifier}.ts`, url)), module, module.exports);
        return module.exports;
    }
    load(`${pageName}.ts`);
    return { page, profile, load, calls, keyboardCallbacks };
}

test('all 27 existing fields retain their guide title and hint, including packaged art for both silhouettes', () => {
    const { load } = environment();
    const { measurementGroups } = load('types/api.ts');
    const { measurementGuide } = load('features/measurement-guide.ts');
    const fields = measurementGroups.flatMap(group => group.fields);
    const assets = new Set();
    assert.equal(new Set(fields.map(([key]) => key)).size, 27);
    for (const [key, label, hint] of fields) {
        for (const gender of ['FEMALE', 'MALE']) {
            const guide = measurementGuide(key, gender);
            assert.equal(guide.label, label);
            assert.equal(guide.hint, hint);
            assert.ok(hint.trim());
            if (key === 'weight') {
                assert.equal(guide.image, '');
                assert.equal(guide.view, '');
                continue;
            }
            assert.match(guide.image, /^\/assets\/measurements\/[\w-]+\.png$/);
            const png = readImage(guide);
            assert.deepEqual(png.subarray(0, 8), pngSignature);
            assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
            assets.add(guide.image.split('/').at(-1));
        }
    }
    assert.equal(assets.size, 48);
    assert.deepEqual([...assets].sort(), readdirSync(new URL('assets/measurements/', source)).filter(name => name.endsWith('.png')).sort());
    assert.equal(measurementGuide('not-a-measurement', null), null);
});

test('guide picks the waist ring, back landmarks, cropped head, and the correct foot and dimension', () => {
    const { load } = environment();
    const { measurementGuide } = load('features/measurement-guide.ts');
    const examples = [
        ['waist', '正面', 'female-waist'], ['backWidth', '背面', 'female-backWidth'],
        ['backWaistLength', '背面', 'female-backWaistLength'], ['head', '头部', 'female-head'],
        ['leftFootLength', '本人左脚 · 俯视', 'leftFootLength'], ['leftFootWidth', '本人左脚 · 俯视', 'leftFootWidth'],
        ['rightFootLength', '本人右脚 · 俯视', 'rightFootLength'], ['rightFootWidth', '本人右脚 · 俯视', 'rightFootWidth']
    ];
    const art = examples.map(([key, view, stem]) => {
        const guide = measurementGuide(key, 'FEMALE');
        assert.equal(guide.view, view);
        assert.equal(guide.image, `/assets/measurements/${stem}.png`);
        return readImage(guide).toString('base64');
    });
    assert.equal(new Set(art).size, examples.length);
});

test('form input does not open the guide; help waits for the delayed keyboard callback and overlay close preserves edits', async () => {
    const { page, profile, calls, keyboardCallbacks } = environment();
    await page.load();
    calls.length = 0;
    page.toggle(tap('躯干'));
    page.field({ ...tap('waist'), detail: { value: '65.5' } });
    const groups = page.data.groups;
    assert.equal(page.data.guideVisible, false);
    assert.equal(keyboardCallbacks.length, 0);

    page.openGuide(tap('waist'));
    assert.equal(keyboardCallbacks.length, 1);
    assert.equal(page.data.guideVisible, false);
    assert.equal(page.data.guide, null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.data.guideVisible, false);
    keyboardCallbacks[0]({ errMsg: 'hideKeyboard:ok' });
    assert.equal(page.data.guideVisible, true);
    assert.equal(page.data.guide.label, '腰围');
    assert.match(page.data.guide.image, /female-waist\.png$/);
    assert.equal(profile.gender, null);

    page.guideVisibilityChanged({ detail: { visible: false, trigger: 'overlay' } });
    assert.equal(page.data.guideVisible, false);
    assert.equal(page.data.groups, groups);
    const torso = page.data.groups.find(group => group.title === '躯干');
    assert.equal(torso.open, true);
    assert.equal(torso.fields.find(field => field.key === 'waist').value, '65.5');
    assert.deepEqual(calls, []);
});

test('existing profile selects male art; explicit close preserves the form and weight opens with only text', async () => {
    const { page, calls, keyboardCallbacks } = environment('MALE');
    await page.load();
    calls.length = 0;
    const groups = page.data.groups;
    page.openGuide(tap('head'));
    keyboardCallbacks[0]({ errMsg: 'hideKeyboard:ok' });
    assert.match(page.data.guide.image, /male-head\.png$/);
    page.closeGuide();
    assert.equal(page.data.guideVisible, false);
    page.openGuide(tap('weight'));
    keyboardCallbacks[1]({ errMsg: 'hideKeyboard:fail keyboard is not open' });
    assert.equal(page.data.guideVisible, true);
    assert.equal(page.data.guide.label, '体重');
    assert.equal(page.data.guide.image, '');
    assert.equal(page.data.guide.hint, '轻装、同一时段称量');
    page.closeGuide();
    assert.equal(page.data.groups, groups);
    assert.deepEqual(calls, []);
});

test('latest guide tap wins if keyboard callbacks finish out of order', () => {
    const { page, keyboardCallbacks } = environment();
    page.openGuide(tap('waist'));
    page.openGuide(tap('backWidth'));
    keyboardCallbacks[1]();
    keyboardCallbacks[0]();
    assert.equal(page.data.guide.label, '背宽');
    assert.equal(page.data.guideVisible, true);
});

test('hiding or unloading the page discards pending guide callbacks', () => {
    const { page, keyboardCallbacks } = environment();
    page.openGuide(tap('waist'));
    page.onHide();
    keyboardCallbacks[0]();
    assert.equal(page.data.guideVisible, false);
    page.openGuide(tap('head'));
    page.onUnload();
    keyboardCallbacks[1]();
    assert.equal(page.data.guideVisible, false);
});

test('save current and save as history keep their original operations and measurement payload', async () => {
    const { page, calls, keyboardCallbacks } = environment('MALE');
    await page.load();
    calls.length = 0;
    page.field({ ...tap('height'), detail: { value: '171.25' } });
    page.openGuide(tap('height'));
    keyboardCallbacks[0]();
    page.closeGuide();
    await page.save({ currentTarget: { dataset: { mode: 'current' } } });
    await page.save({ currentTarget: { dataset: { mode: 'new' } } });
    const writes = calls.filter(call => call.method);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].method, 'PATCH');
    assert.equal(writes[0].path, '/profile/current-measurement');
    assert.equal(writes[0].body.height, 171.25);
    assert.equal(writes[0].body.waist, null);
    assert.equal(writes[0].body.gender, 'MALE');
    assert.equal(writes[0].body.version, '3');
    assert.equal(Object.keys(writes[0].body).length, 29);
    assert.equal(writes[1].method, 'POST');
    assert.equal(writes[1].path, '/profile/measurements');
    assert.equal(writes[1].body.height, 165); // Refreshed from the offline profile after saving current.
});

test('size editor loads the current profile without fetching history', async () => {
    const { page, calls } = environment();
    await page.load();
    assert.deepEqual(calls, [{ path: '/profile' }]);
    assert.equal(typeof page.openHistory, 'function');
    assert.equal(page.data.items, undefined);
    assert.equal(page.use, undefined);
    assert.equal(page.remove, undefined);
});
