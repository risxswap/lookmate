import { ApiError, request } from '../../lib/request';
import { getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, errorMessage } from '../../lib/ui';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import { displayUrl, fileUrl } from '../../lib/files';
import { readDraft, saveDraft, requestKey } from '../../lib/storage';
import { pendingSubmission, sendSubmission } from '../../features/design';
import { dictionaries, presetScenes } from '../../types/api';
import type { DesignInput, DesignType, Profile, Photo, Dress, Hairstyle, OutfitInspiration, Preview, PendingSubmission } from '../../types/api';

const titles: Record<DesignType, string> = { HAIRSTYLE: '发型设计', OUTFIT: '穿搭设计', OVERALL: '整体设计' };
const photoAngles: Record<string, string> = { SIDE_FACE: '侧脸', BACK_HEAD: '后脑', SIDE_BODY: '侧面全身', BACK_BODY: '背面全身' };

type PreferenceField = 'occasion' | 'style';
const designPreferences: { key: PreferenceField; label: string; options: string[]; placeholder: string }[] = [
    { key: 'occasion', label: '场景', options: presetScenes.slice(0, 3), placeholder: '输入这次设计的场景' },
    { key: 'style', label: '风格', options: [dictionaries.styles.MINIMAL, dictionaries.styles.CASUAL, dictionaries.styles.RETRO], placeholder: '输入你想尝试的风格' }
];

type PhotoChoice = Photo & { url: string; label: string };
type DressChoice = { id: string; name: string; url: string };
function markDresses(choices: DressChoice[], picked: DressChoice[]) {
    const ids = new Set(picked.map(item => item.id));
    return choices.map(item => ({ ...item, selected: ids.has(item.id) }));
}

type ReferenceChoice = { name: string; url: string; warning: string };
type Issue = { area: 'photo' | 'reference' | 'dresses' | 'check'; message: string };

const initial = (mode: DesignType): DesignInput => ({
    designType: mode, personFileId: '', profileVersion: '', requirements: '', occasion: '', style: '',
    weatherNote: '', requiredDressIds: [], useMeasurements: false, measurementId: null, constraintOverrides: []
});

async function thumbnail(load: () => Promise<string>): Promise<string> {
    try {
        return await load();
    } catch (error) {
        if (error instanceof ApiError && error.detail.code === 'ACCOUNT_CHANGED') throw error;
        return '';
    }
}

async function loadReference(input: DesignInput): Promise<ReferenceChoice | null> {
    const hair = input.hairstyleId;
    const referenceId = hair || input.outfitInspirationId;
    if (!referenceId) return null;
    try {
        const base = hair ? '/hairstyles' : '/outfit-inspirations';
        const item = await request<Hairstyle | OutfitInspiration>(`${base}/${encodeURIComponent(referenceId)}`);
        const source = 'images' in item
            ? item.images.find(image => image.angle === 'FRONT')?.url || item.images[0]?.url
            : item.image?.url;
        const version = hair ? input.hairstyleVersion : input.outfitInspirationVersion;
        const warning = item.availability === 'UNAVAILABLE' ? '这份参考暂不可用，可移除或返回图库重选。'
            : item.version !== version ? '这份参考已更新，可移除或返回图库重选。' : '';
        return { name: item.name, url: source ? await thumbnail(() => displayUrl(source)) : '', warning };
    } catch (error) {
        if (error instanceof ApiError && error.detail.code === 'ACCOUNT_CHANGED') throw error;
        return { name: hair ? '发型参考' : '穿搭参考', url: '', warning: '暂时无法查看这份参考。' };
    }
}

async function dressChoice(dress: Dress): Promise<DressChoice> {
    const fileId = dress.images[0]?.fileId;
    return { id: dress.id, name: dress.name, url: fileId ? await thumbnail(() => fileUrl(fileId, 'THUMBNAIL')) : '' };
}

async function savedDressChoice(dressId: string): Promise<DressChoice> {
    try {
        return await dressChoice(await api.dress(dressId));
    } catch (error) {
        if (error instanceof ApiError && error.detail.code === 'ACCOUNT_CHANGED') throw error;
        return { id: dressId, name: '已选衣物', url: '' };
    }
}

function issueFor(error: unknown, mode: DesignType): Issue {
    const code = error instanceof ApiError ? error.detail.code : '';
    let area: Issue['area'] = 'check';
    if (['PERSON_PHOTO_INSUFFICIENT', 'FILE_NOT_USABLE'].includes(code)) area = 'photo';
    if (/^(HAIRSTYLE|OUTFIT_INSPIRATION)_/.test(code)) area = 'reference';
    if (mode !== 'HAIRSTYLE' && ['REQUIRED_DRESS_UNAVAILABLE', 'WARDROBE_EMPTY', 'INPUT_BUDGET_EXCEEDED'].includes(code)) area = 'dresses';
    return { area, message: errorMessage(error) };
}

Page({
    dressList: null as PagedList<Dress> | null,
    photoThumbRead: null as Promise<void> | null,
    entryReference: {} as Record<string, string | undefined>,
    data: {
        mode: 'HAIRSTYLE' as DesignType, input: initial('HAIRSTYLE'), profile: null as Profile | null,
        photoChoicesOpen: false, designPreferences, customPreference: { occasion: false, style: false }, focusPreference: '',
        photos: [] as PhotoChoice[], selectedPhoto: null as PhotoChoice | null, reference: null as ReferenceChoice | null,
        dresses: [] as (DressChoice & { selected: boolean })[], selectedDresses: [] as DressChoice[], dressMore: false, dressLoaded: false,
        stagedDresses: null as DressChoice[] | null, dressRefreshing: false, dressError: '', dressRetryRefresh: false, dressesOpen: false, settingsOpen: false, keyboardOpen: false,
        preview: null as Preview | null, reviewOpen: false,
        pending: null as PendingSubmission | null, overrideOptions: [] as { id: string; text: string; checked: boolean }[],
        issue: null as Issue | null, busy: false, error: '', ready: false, accountId: ''
    },
    onLoad(q: Record<string, string | undefined>) {
        const mode = q.mode === 'OVERALL' || q.mode === 'OUTFIT' ? q.mode : 'HAIRSTYLE';
        this.dressList = new PagedList<Dress>();
        this.entryReference = { referenceId: q.referenceId, referenceVersion: q.referenceVersion };
        this.setData({ mode });
        wx.setNavigationBarTitle({ title: titles[mode] });
        return this.load();
    },
    onShow() {
        if (this.data.ready) void this.load();
    },
    async onPullDownRefresh() {
        try {
            if (!this.data.reviewOpen && this.data.stagedDresses === null) await this.load();
        } finally {
            wx.stopPullDownRefresh();
        }
    },
    onHide() {
        this.photoThumbRead = null;
        this.persist();
    },
    onUnload() {
        this.photoThumbRead = null;
        this.persist();
    },
    go,
    async load() {
        await action(this, async () => {
            this.photoThumbRead = null;
            const account = await owner();
            if (!account) return;
            const mode = this.data.mode;
            const [profile, slots] = await Promise.all([
                api.profile(),
                request<{ portrait: Photo | null; fullBody: Photo | null; angles: Record<string, Photo | null> }>('/photos/slots')
            ]);
            const input = { ...initial(mode), ...readDraft<DesignInput>(mode), profileVersion: profile.version };
            const { referenceId, referenceVersion } = this.entryReference;
            if (referenceId && mode === 'HAIRSTYLE') {
                Object.assign(input, { hairstyleId: referenceId, hairstyleVersion: referenceVersion, useReferenceHairColor: false });
            } else if (referenceId && mode === 'OUTFIT') {
                Object.assign(input, { outfitInspirationId: referenceId, outfitInspirationVersion: referenceVersion });
            }
            const photoItems = [slots.portrait, slots.fullBody, ...Object.values(slots.angles || {})].filter((item): item is Photo => !!item);
            if (!input.personFileId) input.personFileId = (mode === 'HAIRSTYLE' ? slots.portrait : slots.fullBody)?.fileId || '';
            const compactPhoto = mode === 'OVERALL' && photoItems.some(photo => photo.fileId === input.personFileId);
            if (input.useMeasurements) input.measurementId = profile.currentMeasurementId;
            const [photos, reference, selectedDresses] = await Promise.all([
                Promise.all(photoItems.map(async photo => ({
                    ...photo, url: !compactPhoto || photo.fileId === input.personFileId ? await thumbnail(() => fileUrl(photo.fileId, 'THUMBNAIL')) : '',
                    label: photo.photoType === 'PORTRAIT' ? '正面头像照' : photo.photoType === 'FULL_BODY' ? '正面全身照' : photoAngles[photo.angle || ''] || '补充照片'
                }))),
                loadReference(input),
                Promise.all(input.requiredDressIds.map(savedDressChoice))
            ]);
            if (!stillOwner(account)) return;
            this.entryReference = {};
            const selectedPhoto = photos.find(photo => photo.fileId === input.personFileId) || null;
            const customPreference = { occasion: false, style: false };
            for (const { key, options } of designPreferences) {
                customPreference[key] = !!input[key] && !options.includes(input[key]);
            }
            this.setData({
                accountId: account, profile, input, photos, selectedPhoto, photoChoicesOpen: !selectedPhoto, customPreference, focusPreference: '',
                reference, selectedDresses, pending: pendingSubmission(), ready: true,
                issue: null, preview: null, reviewOpen: false, overrideOptions: []
            });
            this.persist();
            if (mode !== 'HAIRSTYLE' && this.data.dressesOpen) await this.fetchDresses(true);
        });
    },
    persist() {
        if (this.data.ready && stillOwner(this.data.accountId)) saveDraft(this.data.mode, this.data.input);
    },
    change(patch: Partial<DesignInput>) {
        if (!this.data.ready || this.data.busy || this.data.reviewOpen || !stillOwner(this.data.accountId)) return false;
        this.setData({ input: { ...this.data.input, ...patch }, preview: null, issue: null, error: '' });
        this.persist();
        return true;
    },
    field(e: Event) {
        this.change({ [id(e)]: value(e) });
    },
    choosePreference(e: Event) {
        const { key, choice } = e.currentTarget.dataset;
        const group = designPreferences.find(item => item.key === key);
        if (!group || this.data.mode !== 'OVERALL' || this.data.pending) return;
        const field = group.key;
        const custom = choice === 'custom';
        if (!custom && !group.options.includes(choice)) return;
        const wasCustom = this.data.customPreference[field];
        const openCustom = custom && !wasCustom;
        const current = this.data.input[field] || '';
        let next = current;
        if (!openCustom) next = custom || (!wasCustom && choice === current) ? '' : choice;
        if (!this.change({ [field]: next })) return;
        this.setData({
            customPreference: { ...this.data.customPreference, [field]: openCustom },
            focusPreference: openCustom ? field : ''
        });
    },
    openPhotoChoices() {
        if (this.data.busy || this.data.pending || !stillOwner(this.data.accountId)) return;
        return this.revealPhotoChoices();
    },
    revealPhotoChoices() {
        this.setData({ photoChoicesOpen: true });
        if (this.photoThumbRead || this.data.photos.every(photo => photo.url)) return this.photoThumbRead;
        const account = this.data.accountId;
        const read = Promise.all(this.data.photos.map(async photo => photo.url ? photo : {
            ...photo, url: await fileUrl(photo.fileId, 'THUMBNAIL').catch(() => '')
        })).then(photos => {
            if (this.photoThumbRead !== read) return;
            this.photoThumbRead = null;
            if (stillOwner(account)) this.setData({
                photos, selectedPhoto: photos.find(photo => photo.fileId === this.data.input.personFileId) || null
            });
        });
        this.photoThumbRead = read;
        return read;
    },
    photo(e: Event) {
        if (this.data.mode === 'OVERALL' && this.data.pending) return;
        const selectedPhoto = this.data.photos.find(photo => photo.fileId === id(e));
        if (selectedPhoto && this.change({ personFileId: selectedPhoto.fileId })) this.setData({ selectedPhoto, photoChoicesOpen: false });
    },
    addPhoto() {
        if (!this.data.ready || this.data.pending || !stillOwner(this.data.accountId)) return;
        wx.navigateTo({ url: '/pages/photos/index' });
    },
    keyboardHeightChanged(e: Event) {
        this.setData({ keyboardOpen: Number(e.detail.height) > 0 });
    },
    keyboardBlurred(e?: Event) {
        const field = e && id(e);
        this.setData({ keyboardOpen: false, ...(field === this.data.focusPreference ? { focusPreference: '' } : {}) });
    },
    measurement(e: Event) {
        const useMeasurements = !!e.detail.value;
        this.change({ useMeasurements, measurementId: useMeasurements ? this.data.profile?.currentMeasurementId || null : null });
    },
    hairColor(e: Event) {
        this.change({ useReferenceHairColor: !!e.detail.value });
    },
    clearReference() {
        if (this.change({
            hairstyleId: null, hairstyleVersion: null, outfitInspirationId: null, outfitInspirationVersion: null, useReferenceHairColor: false
        })) this.setData({ reference: null });
    },
    referenceImageError() {
        if (this.data.reference) this.setData({ reference: { ...this.data.reference, url: '' } });
    },
    toggleSettings() {
        this.setData({ settingsOpen: !this.data.settingsOpen });
    },
    async openDressPicker() {
        if (this.data.mode !== 'OVERALL' || !this.data.ready || this.data.busy || this.data.pending ||
            this.data.reviewOpen || this.data.stagedDresses !== null || !stillOwner(this.data.accountId)) return;
        const stagedDresses = this.data.selectedDresses.slice();
        this.setData({ stagedDresses, dresses: markDresses(this.data.dresses, stagedDresses) });
        if (!this.data.dressLoaded && !this.data.dressError) await this.moreDresses();
    },
    closeDressPicker(e?: Event) {
        if (e?.detail?.visible !== true) this.setData({ stagedDresses: null });
    },
    applyDressPicker() {
        const selectedDresses = this.data.stagedDresses;
        if (!selectedDresses || this.data.pending || !this.change({ requiredDressIds: selectedDresses.map(item => item.id) })) return;
        this.setData({ selectedDresses, stagedDresses: null });
    },
    async refreshDressPicker() {
        if (this.data.stagedDresses === null || this.data.busy) return;
        await action(this, async () => {
            this.setData({ dressRefreshing: true });
            try {
                await this.fetchDresses(true);
            } finally {
                this.setData({ dressRefreshing: false });
            }
        });
    },
    async nextDressPage() {
        if (this.data.stagedDresses !== null && this.data.dressMore && !this.data.dressError) await this.moreDresses();
    },
    async toggleDresses() {
        const dressesOpen = !this.data.dressesOpen;
        this.setData({ dressesOpen });
        if (dressesOpen && (!this.data.dressLoaded || this.data.dressError)) await this.moreDresses();
    },
    async fetchDresses(refresh: boolean) {
        const dressList: PagedList<Dress> | null = this.dressList;
        if (!dressList) return;
        this.setData({ dressError: '' });
        try {
            await dressList.load(api.dresses, refresh);
            const current = new Map(this.data.dresses.map(dress => [dress.id, dress]));
            const choices = await Promise.all(dressList.items.map(dress => (!refresh && current.get(dress.id)) || dressChoice(dress)));
            this.setData({
                dresses: markDresses(choices, this.data.stagedDresses ?? this.data.selectedDresses),
                dressMore: dressList.hasMore, dressLoaded: true, dressRetryRefresh: false
            });
        } catch (error) {
            if (error instanceof ApiError && error.detail.code === 'ACCOUNT_CHANGED') throw error;
            this.setData({ dressError: errorMessage(error), dressRetryRefresh: refresh });
        }
    },
    async moreDresses() {
        await action(this, () => this.fetchDresses(this.data.dressRetryRefresh));
    },
    dress(e: Event) {
        const choice = this.data.dresses.find(dress => dress.id === id(e));
        if (!choice) return;
        if (choice.selected) this.removeDress(e);
        else this.selectDresses([...(this.data.stagedDresses ?? this.data.selectedDresses), choice]);
    },
    removeDress(e: Event) {
        const key = id(e);
        this.selectDresses((this.data.stagedDresses ?? this.data.selectedDresses).filter(dress => dress.id !== key));
    },
    selectDresses(picked: DressChoice[]) {
        if (this.data.mode === 'OVERALL') {
            if (this.data.stagedDresses === null || this.data.busy || !stillOwner(this.data.accountId)) return;
            this.setData({ stagedDresses: picked, dresses: markDresses(this.data.dresses, picked) });
        } else if (this.change({ requiredDressIds: picked.map(dress => dress.id) })) {
            this.setData({ selectedDresses: picked, dresses: markDresses(this.data.dresses, picked) });
        }
    },
    override(e: Event) {
        const constraintOverrides = e.detail.value as string[];
        if (this.change({ constraintOverrides })) this.setData({ overrideOptions: this.data.overrideOptions.map(option => ({
            ...option, checked: constraintOverrides.includes(option.id)
        })) });
    },
    showIssue(issue: Issue) {
        if (issue.area === 'reference' && !this.data.reference) issue = { ...issue, area: 'check' };
        this.setData({ issue });
        if (issue.area === 'photo' && this.data.mode === 'OVERALL' && !this.data.pending) void this.revealPhotoChoices();
        if (!this.data.pending) this.scrollTo(issue.area);
    },
    scrollTo(area: Issue['area'] | 'pending') {
        wx.nextTick(() => {
            if (stillOwner(this.data.accountId)) wx.pageScrollTo({ selector: `#design-${area}`, offsetTop: -12, duration: 180 });
        });
    },
    async preview() {
        await action(this, async () => {
            if (!this.data.ready || this.data.reviewOpen || this.data.stagedDresses !== null) return;
            if (this.data.pending) {
                this.showIssue({ area: 'check', message: '请先找回待确认的提交' });
                return;
            }
            if (!this.data.selectedPhoto) {
                if (this.data.mode === 'OVERALL' && !this.data.photos.length) {
                    this.addPhoto();
                    return;
                }
                this.showIssue({
                    area: 'photo',
                    message: this.data.photos.length ? '请选择一张可用的本人照片。' : '请添加一张本人照片。'
                });
                return;
            }
            this.setData({ issue: null, preview: null });
            wx.hideKeyboard({ fail: () => {} });
            try {
                const preview = await api.preview(this.data.input);
                this.setData({
                    preview,
                    overrideOptions: preview.restrictions.map(restriction => ({
                        ...restriction, checked: this.data.input.constraintOverrides.includes(restriction.id)
                    })),
                    reviewOpen: preview.canSubmit && !!preview.previewToken
                });
                if (!preview.canSubmit) this.scrollTo('check');
                if (preview.canSubmit && !preview.previewToken) {
                    this.showIssue({ area: 'check', message: '未取得生成确认，请重新检查。' });
                }
            } catch (error) {
                if (error instanceof ApiError && error.detail.code === 'ACCOUNT_CHANGED') throw error;
                this.showIssue(issueFor(error, this.data.mode));
            }
        });
    },
    closeReview(e?: Event) {
        if (e?.detail?.visible !== true && !this.data.busy) this.setData({ reviewOpen: false, preview: null });
    },
    async submit() {
        await action(this, async () => {
            const preview = this.data.preview;
            if (!this.data.reviewOpen || this.data.pending || !preview?.canSubmit || !preview.previewToken) return;
            const account = getAccount();
            if (!account || !stillOwner(this.data.accountId)) return;
            this.setData({ issue: null });
            try {
                const key = await requestKey();
                if (!stillOwner(account.id)) return;
                if (preview.expiresAt && Date.parse(preview.expiresAt) <= Date.now()) {
                    this.showIssue({ area: 'check', message: '检查结果已过期，请重新检查。' });
                    return;
                }
                const pending: PendingSubmission = { kind: 'CREATE', accountId: account.id, key, input: this.data.input, previewToken: preview.previewToken };
                this.setData({ pending });
                const result = await sendSubmission(pending);
                this.setData({ ready: false });
                wx.redirectTo({ url: '/pages/design-detail/index?id=' + result.taskId });
            } catch (error) {
                if (error instanceof ApiError && error.detail.code === 'ACCOUNT_CHANGED') throw error;
                this.showIssue(issueFor(error, this.data.mode));
            } finally {
                if (stillOwner(account.id)) {
                    const pending = pendingSubmission();
                    this.setData({ reviewOpen: false, preview: null, pending });
                    if (pending) this.scrollTo('pending');
                    else if (this.data.issue) this.scrollTo(this.data.issue.area);
                }
            }
        });
    },
    async recover(e: Event) {
        await action(this, async () => {
            const pending = this.data.pending;
            if (!pending) return;
            const resend = !!e.currentTarget.dataset.resend;
            if (resend && !await confirm('确认按原提交重试？')) return;
            try {
                const result = await sendSubmission(pending, !resend);
                this.setData({ ready: false });
                wx.redirectTo({ url: '/pages/design-detail/index?id=' + result.taskId });
            } finally {
                if (stillOwner(pending.accountId)) this.setData({ pending: pendingSubmission() });
            }
        });
    },
    async clearDraft() {
        if (this.data.busy || this.data.pending || !this.data.ready) return;
        if (!await confirm('清除本模式的本地草稿？')) return;
        if (this.data.busy || this.data.pending || !stillOwner(this.data.accountId)) return;
        saveDraft(this.data.mode, null);
        this.setData({
            input: initial(this.data.mode), selectedPhoto: null, reference: null, selectedDresses: [], preview: null,
            reviewOpen: false, issue: null, overrideOptions: [], ready: false, accountId: ''
        });
        await this.load();
    }
});
