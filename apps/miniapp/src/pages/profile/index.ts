import { request } from '../../lib/request';
import { requireAccount, getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, toast, query, errorMessage } from '../../lib/ui';
import { chooseAndUpload, fileUrl } from '../../lib/files';
import { updateAccount } from '../../lib/session';
import { measurementValues, emptyPreferences, dictionaries, cleanPreferences, preferenceErrors, type Profile, type Preferences, type Account } from '../../types/api';
const tagFields = [
    [
        'interests', '兴趣', 'interests'
    ], [
        'styles', '喜欢的风格', 'styles'
    ], [
        'preferredColors', '喜欢的颜色', 'colors'
    ], [
        'avoidedColors', '避免的颜色', 'colors'
    ]
];
const choices = [
    [
        'fits', '版型', 'fits'
    ], [
        'hairLengths', '发长', 'hairLengths'
    ], [
        'restrictions', '明确限制', 'restrictions'
    ]
];
Page({
    data: {
        profile: null as Profile | null, displayName: '', birthDate: '', gender: '', preferences: emptyPreferences(), tagRows: [] as {
            key: string;
            label: string;
            value: string;
        }[], choiceRows: [] as {
            key: string;
            label: string;
            options: {
                code: string;
                label: string;
                checked: boolean;
            }[];
        }[], avatar: '', error: '', busy: false
    },
    onLoad() {
        void this.load();
    }, go,
    async load() {
        await action(this, async () => {
            const account = await owner();
            if (!account)
                return;
            const p = await request<Profile>('/profile');
            const prefs = p.preferences || emptyPreferences();
            const tags = tagFields.map(([key, label, dict]) => ({
                key, label, value: (prefs[key as keyof Preferences] as {
                    type: string;
                    code?: string;
                    text?: string;
                }[]).map(t => t.text || (dictionaries[dict as keyof typeof dictionaries] as Record<string, string>)[t.code || ''] || '').join('、')
            }));
            const rows = choices.map(([key, label, dict]) => ({
                key, label, options: Object.entries(dictionaries[dict as keyof typeof dictionaries]).map(([code, label]) => ({
                    code, label, checked: (prefs[key as keyof Preferences] as string[]).includes(code)
                }))
            }));
            const a = getAccount();
            const avatar = a?.avatarFileId ? await fileUrl(a.avatarFileId) : '';
            if (stillOwner(account))
                this.setData({
                    profile: p, displayName: p.displayName || '', birthDate: p.birthDate || '', gender: p.gender || '', preferences: prefs, tagRows: tags, choiceRows: rows, avatar
                });
        });
    },
    field(e: Event) {
        this.setData({
            [String(e.currentTarget.dataset.key)]: value(e)
        });
    },
    tag(e: Event) {
        const rows = this.data.tagRows.map(r => r.key === id(e) ? {
            ...r, value: value(e)
        } : r);
        this.setData({
            tagRows: rows
        });
    },
    choose(e: Event) {
        const key = id(e) as keyof Preferences;
        const values = e.detail.value as string[];
        this.setData({
            ['preferences.' + key]: values, choiceRows: this.data.choiceRows.map(r => r.key === key ? {
                ...r, options: r.options.map(o => ({
                    ...o, checked: values.includes(o.code)
                }))
            } : r)
        });
    },
    pref(e: Event) {
        this.setData({
            ['preferences.' + id(e)]: value(e) || null
        });
    },
    async avatar() {
        await action(this, async () => {
            const files = await chooseAndUpload();
            if (!files[0])
                return;
            const a = await request<Account>('/profile/avatar', {
                method: 'PUT', body: {
                    fileId: files[0]
                }
            });
            updateAccount(a);
            this.setData({
                avatar: await fileUrl(files[0])
            });
            toast('账号头像已更新');
        });
    },
    async clearAvatar() {
        await action(this, async () => {
            const a = await request<Account>('/profile/avatar', {
                method: 'PUT', body: {
                    fileId: null
                }
            });
            updateAccount(a);
            this.setData({
                avatar: ''
            });
        });
    },
    async save() {
        await action(this, async () => {
            if (!this.data.profile)
                return;
            const prefs = {
                ...this.data.preferences
            };
            for (const row of this.data.tagRows)
                (prefs as unknown as Record<string, unknown>)[row.key] = row.value.split(/[、,，]/).map(x => x.trim()).filter(Boolean).map(text => ({
                    type: 'CUSTOM', text
                }));
            const errors = preferenceErrors(prefs);
            if (errors.length)
                throw new Error(errors[0]);
            const p = await request<Profile>('/profile/form', {
                method: 'PUT', body: {
                    version: this.data.profile.version, displayName: this.data.displayName.trim() || null, gender: this.data.gender || null, birthDate: this.data.birthDate || null, measurements: measurementValues(this.data.profile.currentMeasurement), preferences: cleanPreferences(prefs)
                }
            });
            this.setData({
                profile: p
            });
            const a = getAccount();
            if (a)
                updateAccount({
                    ...a, displayName: p.displayName
                });
            toast('资料已保存');
        });
    }
});
