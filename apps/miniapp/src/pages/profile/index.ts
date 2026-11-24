import { ApiError, assertAccount, request } from '../../lib/request';
import { getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, type Event } from '../../features/page';
import { confirm, toast } from '../../lib/ui';
import { fileUrl, uploadImage } from '../../lib/files';
import { updateAccount } from '../../lib/session';
import { openAvatarCrop, type AvatarCrop } from './avatar-crop';
import {
    measurementValues, emptyPreferences, dictionaries, cleanPreferences, preferenceErrors,
    type Profile, type PreferenceTag, type Account
} from '../../types/api';

const tagFields = [
    ['interests', '兴趣与活动', dictionaries.interests],
    ['styles', '喜欢的风格', dictionaries.styles],
    ['preferredColors', '喜欢的颜色', dictionaries.colors],
    ['avoidedColors', '避免的颜色', dictionaries.colors]
] as const;
type TagKey = typeof tagFields[number][0];
const choiceFields = ['fits', 'hairLengths', 'restrictions'] as const;
type ChoiceKey = typeof choiceFields[number];
const birthDateStart = '1000-01-01';
type CropSession = { accountId: string; editor?: AvatarCrop };
const cropSessions = new WeakMap<object, CropSession>();

function choiceOptions(key: ChoiceKey, selected: string[]) {
    return Object.entries(dictionaries[key]).map(([code, label]) => ({
        code, label, checked: selected.includes(code)
    }));
}

function birthDateEnd(): string {
    // The profile endpoint validates dates in Asia/Shanghai.
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isCancellation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'errMsg' in error
        && /\bcancel(?:led|ed)?\b/i.test(String(error.errMsg));
}

async function chooseAvatarPhoto(): Promise<string | null> {
    const source = await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult>((resolve, reject) => {
        wx.chooseMedia({
            count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'],
            success: resolve, fail: reject
        });
    }).catch((error: unknown) => {
        if (isCancellation(error)) return null;
        throw new Error('无法选择照片，请检查相机或相册权限后重试');
    });
    return source?.tempFiles[0]?.tempFilePath || null;
}

Page({
    data: {
        profile: null as Profile | null,
        displayName: '',
        birthDate: '',
        birthDateStart,
        birthDateEnd: birthDateEnd(),
        gender: '',
        genderOptions: [{ code: 'FEMALE', label: '女' }, { code: 'MALE', label: '男' }],
        acceptanceOptions: [{ code: 'ACCEPT', label: '接受' }, { code: 'REJECT', label: '不接受' }],
        groomingOptions: [{ code: 'LOW', label: '少' }, { code: 'MEDIUM', label: '适中' }, { code: 'HIGH', label: '较多' }],
        preferences: emptyPreferences(),
        tagRows: [] as { key: TagKey; label: string; value: string; initial: string }[],
        choiceRows: { fits: choiceOptions('fits', []), hairLengths: choiceOptions('hairLengths', []), restrictions: choiceOptions('restrictions', []) },
        avatar: '',
        avatarFileId: '',
        cropOpen: false,
        cropReady: false,
        cropZoom: 100,
        error: '',
        operation: 'load' as 'load' | 'avatar' | 'save',
        versionConflict: false,
        keyboardOpen: false,
        busy: false
    },
    onLoad() {
        return this.load();
    },
    onShow() {
        this.setData({ birthDateEnd: birthDateEnd() });
    },
    onUnload() {
        cropSessions.delete(this);
    },
    async load() {
        if (this.data.busy || this.data.cropOpen) return;
        this.setData({ operation: 'load' });
        await action(this, async () => {
            const account = await owner();
            if (!account) return;
            const profile = await request<Profile>('/profile');
            const preferences = profile.preferences || emptyPreferences();
            const tagRows = tagFields.map(([key, label, dictionary]) => {
                const initial = preferences[key].map(tag => tag.type === 'CUSTOM' ? tag.text : (dictionary as Record<string, string>)[tag.code] || '').join('、');
                return { key, label, value: initial, initial };
            });
            const avatarFileId = getAccount()?.avatarFileId || '';
            if (!stillOwner(account)) return;
            this.setData({
                profile, displayName: profile.displayName || '', birthDate: profile.birthDate || '',
                gender: profile.gender || '', preferences, tagRows, avatarFileId, avatar: '',
                versionConflict: false,
                choiceRows: {
                    fits: choiceOptions('fits', preferences.fits),
                    hairLengths: choiceOptions('hairLengths', preferences.hairLengths),
                    restrictions: choiceOptions('restrictions', preferences.restrictions)
                }
            });
            if (avatarFileId) {
                const avatar = await fileUrl(avatarFileId, 'THUMBNAIL').catch(() => '');
                if (stillOwner(account)) this.setData({ avatar });
            }
        });
        if (this.data.profile && this.data.error) this.setData({ operation: 'save' });
    },
    field(e: Event) {
        if (this.data.busy) return;
        this.setData({ [id(e)]: value(e) });
    },
    selectBirthday(e: Event) {
        if (this.data.busy) return;
        const date = value(e);
        const lastDay = birthDateEnd();
        const day = new Date(date + 'T00:00:00Z');
        if (date < birthDateStart || date > lastDay || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
            toast('请选择 1000 年 1 月 1 日至今天之间的有效日期');
            return;
        }
        this.setData({ birthDate: date, birthDateEnd: lastDay });
    },
    tag(e: Event) {
        if (this.data.busy) return;
        const tagRows = this.data.tagRows.map(row => row.key === id(e) ? { ...row, value: value(e) } : row);
        this.setData({ tagRows });
    },
    choose(e: Event) {
        if (this.data.busy) return;
        const key = id(e) as ChoiceKey;
        const values = e.detail.value as string[];
        this.setData({
            ['preferences.' + key]: values,
            ['choiceRows.' + key]: choiceOptions(key, values)
        });
    },
    pref(e: Event) {
        if (this.data.busy) return;
        this.setData({ ['preferences.' + id(e)]: value(e) || null });
    },
    keyboardHeightChanged(e: Event) {
        this.setData({ keyboardOpen: Number(e.detail.height) > 0 });
    },
    keyboardBlurred() {
        this.setData({ keyboardOpen: false });
    },
    avatarError() {
        this.setData({ avatar: '' });
    },
    async changeAvatar() {
        if (this.data.busy || this.data.cropOpen) return;
        this.setData({ operation: 'avatar' });
        await action(this, async () => {
            const accountId = getAccount()?.id;
            if (!accountId) return;
            const session: CropSession = { accountId };
            cropSessions.set(this, session);
            try {
                const path = await chooseAvatarPhoto();
                if (!path || cropSessions.get(this) !== session) return;
                assertAccount(accountId);
                this.setData({ cropOpen: true, cropReady: false, cropZoom: 100 });
                await new Promise<void>(resolve => wx.nextTick(resolve));
                if (cropSessions.get(this) !== session) return;
                const editor = await openAvatarCrop(path);
                if (cropSessions.get(this) !== session) return;
                assertAccount(accountId);
                session.editor = editor;
                this.setData({ cropReady: true });
            } catch (error) {
                if (cropSessions.get(this) !== session) return;
                this.setData({ cropOpen: false });
                throw error;
            } finally {
                if (!session.editor && cropSessions.get(this) === session) cropSessions.delete(this);
            }
        });
    },
    cancelAvatarCrop() {
        if (this.data.busy && this.data.cropReady) return;
        cropSessions.delete(this);
        this.setData({ cropOpen: false, cropReady: false, error: '' });
    },
    stopAvatarCropScroll() {},
    beginAvatarCropGesture(e: WechatMiniprogram.TouchEvent) {
        if (!this.data.busy) cropSessions.get(this)?.editor?.begin(e.touches);
    },
    moveAvatarCropGesture(e: WechatMiniprogram.TouchEvent) {
        const editor = cropSessions.get(this)?.editor;
        if (this.data.busy || !editor) return;
        editor.move(e.touches);
        const cropZoom = Math.round(editor.zoom * 100);
        if (cropZoom !== this.data.cropZoom) this.setData({ cropZoom });
    },
    setAvatarCropZoom(e: Event) {
        const editor = cropSessions.get(this)?.editor;
        const cropZoom = Number(e.detail.value);
        if (this.data.busy || !editor || !Number.isFinite(cropZoom)) return;
        editor.setZoom(cropZoom / 100);
        this.setData({ cropZoom: Math.round(editor.zoom * 100) });
    },
    async saveAvatarCrop() {
        const session = cropSessions.get(this);
        const editor = session?.editor;
        if (this.data.busy || !session || !editor) return;
        const { accountId } = session;
        await action(this, async () => {
            assertAccount(accountId);
            const path = await editor.exportImage();
            if (cropSessions.get(this) !== session) return;
            assertAccount(accountId);
            const size = await new Promise<number>((resolve, reject) => {
                wx.getFileSystemManager().getFileInfo({
                    filePath: path, success: result => resolve(result.size),
                    fail: () => reject(new Error('无法读取裁切后的照片，请重新选择'))
                });
            });
            if (cropSessions.get(this) !== session) return;
            assertAccount(accountId);
            const fileId = await uploadImage(path, size);
            if (cropSessions.get(this) !== session) return;
            assertAccount(accountId);
            const account = await request<Account>('/profile/avatar', { method: 'PUT', body: { fileId } });
            updateAccount(account);
            if (cropSessions.get(this) !== session) return;
            cropSessions.delete(this);
            this.setData({ avatar: path, avatarFileId: account.avatarFileId || fileId, cropOpen: false, cropReady: false });
            toast('账号头像已更新');
        });
    },
    async clearAvatar() {
        if (this.data.busy || this.data.cropOpen || !this.data.avatarFileId) return;
        this.setData({ operation: 'avatar' });
        await action(this, async () => {
            const account = await request<Account>('/profile/avatar', { method: 'PUT', body: { fileId: null } });
            updateAccount(account);
            this.setData({ avatar: '', avatarFileId: '' });
            toast('已恢复默认头像');
        });
    },
    async reloadVersion() {
        if (this.data.busy || !this.data.versionConflict) return;
        if (await confirm('重新加载会放弃本页未保存的修改。', '重新加载资料')) await this.load();
    },
    async save() {
        if (this.data.busy || this.data.cropOpen || !this.data.profile) return;
        this.setData({ operation: 'save', versionConflict: false });
        await action(this, async () => {
            const profile = this.data.profile;
            if (!profile) return;
            const preferences = { ...this.data.preferences };
            for (const row of this.data.tagRows) {
                if (row.value === row.initial) continue;
                preferences[row.key] = row.value.split(/[、,，]/).map(text => text.trim()).filter(Boolean)
                    .map((text): PreferenceTag => ({ type: 'CUSTOM', text }));
            }
            const errors = preferenceErrors(preferences);
            if (errors.length) throw new Error(errors[0]);
            const saved = await request<Profile>('/profile/form', {
                method: 'PUT', body: {
                    version: profile.version, displayName: this.data.displayName.trim() || null,
                    gender: this.data.gender || null, birthDate: this.data.birthDate || null,
                    measurements: measurementValues(profile.currentMeasurement), preferences: cleanPreferences(preferences)
                }
            }).catch((error: unknown) => {
                if (error instanceof ApiError && error.detail.code === 'VERSION_CONFLICT') {
                    this.setData({ versionConflict: true });
                }
                throw error;
            });
            this.setData({ profile: saved });
            const account = getAccount();
            if (account) updateAccount({ ...account, displayName: saved.displayName });
            toast('资料已保存');
        });
    }
});
