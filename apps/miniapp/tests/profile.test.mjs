import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = new URL('../src/', import.meta.url);
const tap = (id, value) => ({ currentTarget: { dataset: { id } }, detail: { value } });
const ok = data => ({ statusCode: 200, data: { data } });
const touch = (...points) => ({ touches: points.map(([clientX, clientY], identifier) => ({ clientX, clientY, identifier })) });

function environment() {
    const modules = new Map();
    const stored = new Map();
    const calls = [];
    const statuses = [];
    const confirmations = [];
    let definition;
    let pick = result => result.success({ tempFiles: [{ tempFilePath: 'selected.jpg', size: 5000 }] });
    let loadImage = image => image.onload();
    let exportCrop = result => result.success({ tempFilePath: 'cropped.png' });
    let uploadStatus = 200;
    let saveStatus = 200;
    let confirmReload = false;
    const oldAvatar = 'avatar-before';
    let account = { id: 'A', displayName: 'Ming', avatarFileId: oldAvatar };
    let profile = {
        id: 'A', displayName: 'Ming', gender: null, birthDate: '1903-05-16', version: '9', currentMeasurement: { height: 171 }
    };
    const canvas = {
        width: 0, height: 0,
        getContext(type) {
            assert.equal(type, '2d');
            return {
                clearRect() {},
                drawImage(image, x, y, width, height) {
                    calls.push({ op: 'draw', path: image.src, x, y, width, height });
                },
                beginPath() {},
                rect() {},
                moveTo() {},
                arc() {},
                fill(rule) {
                    assert.equal(rule, 'evenodd');
                },
                stroke() {
                    calls.push({ op: 'guide' });
                }
            };
        },
        createImage() {
            return {
                width: 720, height: 960, path: '',
                get src() { return this.path; },
                set src(path) {
                    this.path = path;
                    loadImage(this);
                }
            };
        }
    };

    const wx = {
        getStorageSync: key => stored.get(key),
        setStorageSync: (key, value) => stored.set(key, value),
        showToast: options => statuses.push(options.title),
        showModal(options) {
            confirmations.push(options.content);
            options.success({ confirm: confirmReload });
        },
        reLaunch: () => {},
        chooseMedia(options) {
            calls.push({ op: 'choose', sourceType: options.sourceType });
            pick(options);
        },
        nextTick: queueMicrotask,
        createSelectorQuery() {
            return {
                select(selector) {
                    assert.equal(selector, '#avatar-crop-canvas');
                    return {
                        fields(options, callback) {
                            assert.equal(options.node, true);
                            return { exec: () => callback({ node: canvas, width: 256, left: 10, top: 20 }) };
                        }
                    };
                }
            };
        },
        canvasToTempFilePath(options) {
            assert.equal(options.canvas, canvas);
            assert.equal(calls.at(-1).op, 'draw');
            const { width, height, destWidth, destHeight, fileType } = options;
            calls.push({ op: 'export', width, height, destWidth, destHeight, fileType });
            exportCrop(options);
        },
        getFileSystemManager() {
            return {
                getFileInfo(options) {
                    calls.push({ op: 'stat', path: options.filePath });
                    options.success({ size: 1140 });
                }
            };
        },
        getImageInfo(options) {
            options.success({ type: options.src.split('.').at(-1) });
        },
        uploadFile(options) {
            calls.push({ op: 'upload', path: options.filePath });
            options.success({ statusCode: uploadStatus });
        },
        request(options) {
            const path = new URL(options.url).pathname.replace(/^\/api/, '');
            const { method, data: body } = options;
            calls.push({ op: 'request', method, path, body });
            const respond = data => options.success(ok(data));
            if (path === '/auth/me' && method === 'GET') respond(account);
            else if (path === '/profile' && method === 'GET') respond(profile);
            else if (path === '/files/upload-intents') respond({ fileId: 'avatar-after', uploadUrl: 'https://uploads.test' });
            else if (path === '/files/avatar-after/complete') respond({ status: 'TEMP' });
            else if (/^\/files\/avatar-.+\/access$/.test(path)) respond({ url: path });
            else if (path === '/profile/avatar' && method === 'PUT') {
                account = { ...account, avatarFileId: body.fileId };
                respond(account);
            } else if (path === '/profile/form' && method === 'PUT') {
                if (saveStatus !== 200) options.success({ statusCode: saveStatus, data: { code: 'SERVICE_ERROR', message: '资料暂时无法保存' } });
                else if (body.version !== profile.version) options.success({ statusCode: 409, data: { code: 'VERSION_CONFLICT', message: '资料已更新，请刷新' } });
                else {
                    profile = {
                        ...profile, version: String(Number(profile.version) + 1),
                        displayName: body.displayName, gender: body.gender, birthDate: body.birthDate, preferences: body.preferences
                    };
                    respond(profile);
                }
            } else throw new Error(`Unexpected ${method} ${path}`);
        }
    };

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

    load(new URL('pages/profile/index.ts', source));
    const session = load(new URL('lib/session.ts', source));
    const { emptyPreferences } = load(new URL('types/api.ts', source));
    profile.preferences = {
        ...emptyPreferences(), interests: [{ type: 'PRESET', code: 'ART' }, { type: 'CUSTOM', text: '展览、手作' }]
    };
    const signIn = identity => session.saveSession({ account: identity, token: 'test-session', expiresAt: '2099-01-01T00:00:00Z' });
    signIn(account);
    const page = {
        ...definition, data: structuredClone(definition.data),
        setData(values) {
            for (const [key, value] of Object.entries(values)) {
                const [container, field] = key.split('.');
                if (field) this.data[container][field] = value;
                else this.data[container] = value;
            }
        }
    };
    return {
        page, calls, statuses, confirmations, oldAvatar,
        signIn, session,
        set pick(value) { pick = value; },
        set loadImage(value) { loadImage = value; },
        set exportCrop(value) { exportCrop = value; },
        set uploadStatus(value) { uploadStatus = value; },
        set saveStatus(value) { saveStatus = value; },
        set confirmReload(value) { confirmReload = value; },
        set profile(value) { profile = { ...profile, ...value }; },
        avatarWrites: () => calls.filter(call => call.path === '/profile/avatar'),
        formWrites: () => calls.filter(call => call.path === '/profile/form')
    };
}

test('avatar persists only the confirmed square crop and its byte count, independently of a pending form', async () => {
    const env = environment();
    const { page, calls } = env;
    await page.onLoad();
    page.field(tap('displayName', '未保存昵称'));
    await page.changeAvatar();
    assert.equal(page.data.cropOpen, true);
    assert.equal(page.data.cropReady, true);
    assert.equal(calls.some(call => ['export', 'stat', 'upload'].includes(call.op)), false);
    assert.equal(env.avatarWrites().length, 0);
    const initial = calls.find(call => call.op === 'draw');
    assert.equal(initial.path, 'selected.jpg');
    assert.equal(initial.x, 0);
    assert.equal(initial.width, 512);
    assert.ok(initial.height > 512 && initial.y < 0);
    assert.equal(calls.at(-1).op, 'guide');

    await page.saveAvatarCrop();
    assert.deepEqual(calls.filter(call => ['export', 'stat', 'upload'].includes(call.op)), [
        { op: 'export', width: 512, height: 512, destWidth: 512, destHeight: 512, fileType: 'png' },
        { op: 'stat', path: 'cropped.png' }, { op: 'upload', path: 'cropped.png' }
    ]);
    const exportIndex = calls.findIndex(call => call.op === 'export');
    assert.deepEqual(calls.slice(exportIndex + 1, exportIndex + 3).map(call => call.op), ['draw', 'guide']);
    const intent = calls.find(call => call.path === '/files/upload-intents');
    assert.deepEqual(structuredClone(intent.body), { originalName: 'photo.png', sizeBytes: 1140, mimeType: 'image/png' });
    assert.equal(env.avatarWrites().length, 1);
    assert.equal(env.avatarWrites()[0].body.fileId, 'avatar-after');
    assert.equal(env.formWrites().length, 0);
    assert.equal(page.data.displayName, '未保存昵称');
    assert.equal(page.data.profile.version, '9');
    assert.equal(page.data.avatar, 'cropped.png');
    assert.equal(page.data.cropOpen, false);
    assert.equal(env.session.session().account.avatarFileId, 'avatar-after');

    await page.clearAvatar();
    assert.equal(env.avatarWrites()[1].body.fileId, null);
    assert.equal(page.data.avatar, '');
    assert.equal(page.data.avatarFileId, '');
    assert.equal(page.data.displayName, '未保存昵称');
});

test('canceling source or crop is silent, and a failed export or upload can be retried', async () => {
    const env = environment();
    const { page, calls } = env;
    await page.onLoad();
    const oldPreview = page.data.avatar;
    env.pick = options => options.fail({ errMsg: 'chooseMedia:fail cancel' });
    await page.changeAvatar();
    assert.equal(calls.some(call => call.op === 'draw'), false);
    env.pick = options => options.success({ tempFiles: [{ tempFilePath: 'selected.jpg' }] });
    await page.changeAvatar();
    page.cancelAvatarCrop();
    assert.equal(page.data.cropOpen, false);
    assert.equal(page.data.error, '');
    assert.equal(page.data.busy, false);
    assert.equal(calls.some(call => ['export', 'stat', 'upload'].includes(call.op)), false);
    assert.equal(env.statuses.length, 0);

    await page.changeAvatar();
    env.exportCrop = options => options.fail({ errMsg: 'export failed' });
    await page.saveAvatarCrop();
    assert.match(page.data.error, /无法生成头像/);
    assert.equal(calls.some(call => call.op === 'stat' || call.op === 'upload'), false);
    assert.equal(page.data.cropOpen, true);
    assert.equal(calls.at(-1).op, 'guide');
    env.exportCrop = options => options.success({ tempFilePath: 'cropped.png' });
    env.uploadStatus = 500;
    await page.saveAvatarCrop();
    assert.match(page.data.error, /上传失败/);
    assert.equal(page.data.avatar, oldPreview);
    assert.equal(page.data.avatarFileId, env.oldAvatar);
    assert.equal(env.avatarWrites().length, 0);
    assert.equal(page.data.cropOpen, true);

    env.uploadStatus = 200;
    await Promise.all([page.saveAvatarCrop(), page.saveAvatarCrop()]);
    assert.equal(env.avatarWrites().length, 1);
    assert.equal(page.data.cropOpen, false);
});

test('a change of account during export cannot upload the old account selection', async () => {
    const env = environment();
    await env.page.onLoad();
    await env.page.changeAvatar();
    env.exportCrop = options => {
        env.signIn({ id: 'B' });
        options.success({ tempFilePath: 'cropped.png' });
    };
    await env.page.saveAvatarCrop();
    assert.equal(env.calls.some(call => call.op === 'stat' || call.op === 'upload'), false);
    assert.equal(env.avatarWrites().length, 0);
});

test('drag, slider zoom and pinch keep the same square canvas covered', async () => {
    const { page, calls } = environment();
    const lastDraw = () => calls.findLast(call => call.op === 'draw');
    await page.onLoad();
    await page.changeAvatar();
    page.beginAvatarCropGesture(touch([138, 148]));
    page.moveAvatarCropGesture(touch([400, 800]));
    assert.equal(lastDraw().x, 0);
    assert.equal(lastDraw().y, 0);
    page.setAvatarCropZoom(tap('', 150));
    assert.equal(page.data.cropZoom, 150);
    assert.equal(lastDraw().width, 768);
    assert.equal(lastDraw().x, -128);
    page.beginAvatarCropGesture(touch([106, 148], [170, 148]));
    page.moveAvatarCropGesture(touch([74, 148], [202, 148]));
    assert.equal(page.data.cropZoom, 300);
    assert.equal(lastDraw().width, 1536);
    page.beginAvatarCropGesture(touch([138, 148]));
    page.moveAvatarCropGesture(touch([-3000, -3000]));
    const { x, y, width, height } = lastDraw();
    assert.equal(x + width, 512);
    assert.equal(y + height, 512);
});

test('an unreadable photo closes the editor and a late export after page unload is discarded', async () => {
    const env = environment();
    const { page } = env;
    await page.onLoad();
    env.loadImage = image => image.onerror();
    await page.changeAvatar();
    assert.match(page.data.error, /无法读取这张照片/);
    assert.equal(page.data.cropOpen, false);
    env.loadImage = image => image.onload();
    await page.changeAvatar();
    env.exportCrop = options => {
        page.onUnload();
        options.success({ tempFilePath: 'cropped.png' });
    };
    await page.saveAvatarCrop();
    assert.equal(env.calls.some(call => call.op === 'stat' || call.op === 'upload'), false);
    assert.equal(env.avatarWrites().length, 0);
});

test('the one birthday picker edits the saved value without losing other fields', async () => {
    const env = environment();
    const { page } = env;
    const markup = readFileSync(new URL('pages/profile/index.wxml', source), 'utf8');
    assert.equal((markup.match(/<picker\b/g) ?? []).length, 1);
    assert.match(markup, /<picker[^>]+start="{{birthDateStart}}"[^>]+end="{{birthDateEnd}}"[^>]+value="{{birthDate \|\| birthDateEnd}}"/);
    assert.doesNotMatch(markup, /<input[^>]+data-id="birthDate"|clearBirthday|清除生日/);
    await page.onLoad();
    assert.equal(page.data.birthDate, '1903-05-16');
    page.selectBirthday(tap('birthDate', '2000-02-29'));
    assert.equal(page.data.birthDate, '2000-02-29');
    page.choose(tap('fits', ['LOOSE']));
    page.pref(tap('hairNote', '自然卷'));
    await page.save();

    const request = env.formWrites()[0].body;
    assert.equal(request.birthDate, '2000-02-29');
    assert.equal(request.measurements.height, 171);
    assert.deepEqual(structuredClone(request.preferences.interests), [
        { type: 'PRESET', code: 'ART' }, { type: 'CUSTOM', text: '展览、手作' }
    ]);
    assert.deepEqual(structuredClone(request.preferences.fits), ['LOOSE']);
    assert.equal(request.preferences.hairNote, '自然卷');
    await page.load();
    assert.equal(page.data.birthDate, '2000-02-29');
    assert.equal(page.data.preferences.hairNote, '自然卷');
});

test('empty birthday and radio fields stay unset until a choice is made', async () => {
    const env = environment();
    env.profile = { birthDate: null };
    const { page } = env;
    await page.onLoad();

    assert.equal(page.data.birthDate, '');
    assert.equal(page.data.gender, '');
    assert.deepEqual(page.data.genderOptions.map(option => option.code), ['FEMALE', 'MALE']);
    assert.deepEqual(page.data.acceptanceOptions.map(option => option.code), ['ACCEPT', 'REJECT']);
    assert.deepEqual(page.data.groomingOptions.map(option => option.code), ['LOW', 'MEDIUM', 'HIGH']);

    await page.save();
    const empty = env.formWrites()[0].body;
    assert.equal(empty.birthDate, null);
    assert.equal(empty.gender, null);
    assert.equal(empty.preferences.dyeAcceptance, null);
    assert.equal(empty.preferences.permAcceptance, null);
    assert.equal(empty.preferences.groomingEffort, null);

    page.field(tap('gender', 'FEMALE'));
    page.pref(tap('dyeAcceptance', 'ACCEPT'));
    page.pref(tap('permAcceptance', 'REJECT'));
    page.pref(tap('groomingEffort', 'MEDIUM'));
    await page.save();
    await page.load();
    assert.equal(page.data.gender, 'FEMALE');
    assert.equal(page.data.preferences.dyeAcceptance, 'ACCEPT');
    assert.equal(page.data.preferences.permAcceptance, 'REJECT');
    assert.equal(page.data.preferences.groomingEffort, 'MEDIUM');
    assert.equal(page.data.birthDate, '');
});

test('invalid and future picker dates keep the previous selection', async () => {
    const env = environment();
    const { page } = env;
    await page.onLoad();
    for (const date of ['0999-12-31', '2099-12-31', '2001-02-29', '2000-2-3', '']) {
        page.selectBirthday(tap('birthDate', date));
        assert.equal(page.data.birthDate, '1903-05-16');
        assert.match(env.statuses.at(-1), /选择.*有效日期/);
    }
    page.selectBirthday(tap('birthDate', '1000-01-01'));
    assert.equal(page.data.birthDate, '1000-01-01');
    page.selectBirthday(tap('birthDate', page.data.birthDateEnd));
    assert.equal(page.data.birthDate, page.data.birthDateEnd);
});

test('saving failure keeps the birthday, text options, and note drafts available for another save', async () => {
    const env = environment();
    const { page } = env;
    await page.onLoad();
    page.selectBirthday(tap('birthDate', '1990-02-03'));
    page.tag(tap('preferredColors', '蓝、墨绿'));
    page.pref(tap('outfitNote', '喜欢轻便'));
    env.saveStatus = 500;
    await page.save();
    assert.match(page.data.error, /无法保存/);
    assert.equal(page.data.birthDate, '1990-02-03');
    assert.equal(page.data.tagRows.find(row => row.key === 'preferredColors').value, '蓝、墨绿');
    assert.equal(page.data.preferences.outfitNote, '喜欢轻便');

    env.saveStatus = 200;
    await page.save();
    assert.equal(page.data.error, '');
    assert.equal(env.formWrites()[1].body.birthDate, '1990-02-03');
    assert.deepEqual(structuredClone(env.formWrites()[1].body.preferences.preferredColors), [
        { type: 'PRESET', code: 'BLUE' }, { type: 'CUSTOM', text: '墨绿' }
    ]);
});

test('a profile version conflict only replaces an unsaved draft on confirmed reload', async () => {
    const env = environment();
    const { page } = env;
    await page.onLoad();
    env.profile = { version: '10', displayName: '另一端的新昵称' };
    page.field(tap('displayName', '我的草稿'));
    await page.save();
    assert.equal(page.data.versionConflict, true);
    assert.equal(page.data.displayName, '我的草稿');

    await page.reloadVersion();
    assert.equal(env.confirmations.length, 1);
    assert.equal(page.data.displayName, '我的草稿');
    assert.equal(page.data.profile.version, '9');

    env.confirmReload = true;
    await page.reloadVersion();
    assert.equal(page.data.profile.version, '10');
    assert.equal(page.data.displayName, '另一端的新昵称');
    assert.equal(page.data.versionConflict, false);
    assert.equal(env.formWrites().length, 1);
});
