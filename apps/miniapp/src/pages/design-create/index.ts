import { request } from '../../lib/request';
import { requireAccount, getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, toast, query, errorMessage } from '../../lib/ui';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import { fileUrls } from '../../lib/files';
import { readDraft, saveDraft, requestKey } from '../../lib/storage';
import { pendingSubmission, rememberSubmission, sendSubmission } from '../../features/design';
import type { DesignInput, DesignType, Profile, Photo, Dress, Preview, PendingSubmission } from '../../types/api';
const dresses = new PagedList<Dress>();
const initial = (mode: DesignType): DesignInput => ({
    designType: mode, personFileId: '', profileVersion: '', requirements: '', occasion: '', style: '', weatherNote: '', requiredDressIds: [], useMeasurements: false, measurementId: null, constraintOverrides: []
});
Page({
    data: {
        mode: 'HAIRSTYLE' as DesignType, input: initial('HAIRSTYLE'), profile: null as Profile | null, photos: [] as (Photo & {
            url: string;
            label: string;
        })[], dresses: [] as (Dress & {
            url: string;
            selected: boolean;
        })[], dressMore: false, preview: null as Preview | null, pending: null as PendingSubmission | null, overrideOptions: [] as {
            id: string;
            text: string;
            checked: boolean;
        }[], busy: false, error: '', ready: false, accountId: ''
    },
    onLoad(q: Record<string, string | undefined>) {
        const mode = [
            'HAIRSTYLE', 'OUTFIT', 'OVERALL'
        ].includes(q.mode || '') ? q.mode as DesignType : 'HAIRSTYLE';
        this.setData({
            mode
        });
        void this.load(q);
    }, onShow() {
        if (this.data.ready)
            void this.load();
    }, onHide() {
        this.persist();
    }, onUnload() {
        this.persist();
    }, go,
    async load(q: Record<string, string | undefined> = {}) {
        await action(this, async () => {
            const account = await owner();
            if (!account)
                return;
            const profile = await api.profile();
            const saved = readDraft<DesignInput>(this.data.mode);
            let input = {
                ...initial(this.data.mode), ...saved, profileVersion: profile.version
            };
            if (q.referenceId)
                input = {
                    ...input, ...(this.data.mode === 'HAIRSTYLE' ? {
                        hairstyleId: q.referenceId, hairstyleVersion: q.referenceVersion, useReferenceHairColor: false
                    } : {
                        outfitInspirationId: q.referenceId, outfitInspirationVersion: q.referenceVersion
                    })
                };
            const slots = await request<{
                portrait: Photo | null;
                fullBody: Photo | null;
                angles: Record<string, Photo | null>;
            }>('/photos/slots');
            const photos = [
                slots.portrait, slots.fullBody, ...Object.values(slots.angles || {})
            ].filter((p): p is Photo => !!p);
            const urls = await fileUrls(photos.map(p => p.fileId));
            if (!input.personFileId)
                input.personFileId = (this.data.mode === 'HAIRSTYLE' ? slots.portrait : slots.fullBody)?.fileId || '';
            if (input.useMeasurements)
                input.measurementId = profile.currentMeasurementId;
            if (!stillOwner(account))
                return;
            this.setData({
                accountId: account, profile, input, photos: photos.map(p => ({
                    ...p, url: urls[p.fileId], label: p.photoType === 'PORTRAIT' ? '正面头像照' : p.photoType === 'FULL_BODY' ? '正面全身照' : (({
                        SIDE_FACE: '侧脸', BACK_HEAD: '后脑', SIDE_BODY: '侧面全身', BACK_BODY: '背面全身'
                    } as Record<string, string>)[p.angle || ''] || '补充照片')
                })), pending: pendingSubmission(), ready: true
            });
            if (this.data.mode !== 'HAIRSTYLE')
                await this.fetchDresses(true);
            this.persist();
        });
    },
    persist() {
        if (this.data.ready && this.data.accountId === getAccount()?.id)
            saveDraft(this.data.mode, this.data.input);
    }, change(patch: Partial<DesignInput>) {
        this.setData({
            input: {
                ...this.data.input, ...patch
            }, preview: null
        });
        this.persist();
    }, field(e: Event) {
        this.change({
            [id(e)]: value(e)
        });
    }, photo(e: Event) {
        this.change({
            personFileId: id(e)
        });
    }, measurement(e: Event) {
        this.change({
            useMeasurements: !!e.detail.value, measurementId: e.detail.value ? this.data.profile?.currentMeasurementId || null : null
        });
    }, hairColor(e: Event) {
        this.change({
            useReferenceHairColor: !!e.detail.value
        });
    }, clearReference() {
        this.change({
            hairstyleId: null, hairstyleVersion: null, outfitInspirationId: null, outfitInspirationVersion: null, useReferenceHairColor: false
        });
    },
    async fetchDresses(refresh: boolean) {
        await dresses.load(api.dresses, refresh);
        const urls = await fileUrls(dresses.items.flatMap(d => d.images[0] ? [
            d.images[0].fileId
        ] : []));
        this.setData({
            dresses: dresses.items.map(d => ({
                ...d, url: urls[d.images[0]?.fileId] || '', selected: this.data.input.requiredDressIds.includes(d.id)
            })), dressMore: dresses.hasMore
        });
        if (dresses.error)
            throw new Error(dresses.error);
    }, async moreDresses() {
        await action(this, () => this.fetchDresses(false));
    }, dress(e: Event) {
        const selected = this.data.input.requiredDressIds;
        const key = id(e);
        this.change({
            requiredDressIds: selected.includes(key) ? selected.filter(v => v !== key) : [
                ...selected, key
            ]
        });
        this.setData({
            dresses: this.data.dresses.map(d => ({
                ...d, selected: this.data.input.requiredDressIds.includes(d.id)
            }))
        });
    },
    override(e: Event) {
        this.change({
            constraintOverrides: e.detail.value as string[]
        });
    },
    async preview() {
        await action(this, async () => {
            if (this.data.pending)
                throw new Error('请先找回待确认的提交');
            if (!this.data.input.personFileId)
                throw new Error('请先添加并选择本人照片');
            const p = await api.preview(this.data.input);
            this.setData({
                preview: p, overrideOptions: p.restrictions.map(r => ({
                    ...r, checked: this.data.input.constraintOverrides.includes(r.id)
                }))
            });
        });
    },
    async submit() {
        await action(this, async () => {
            const p = this.data.preview;
            const a = getAccount();
            if (!p?.canSubmit || !p.previewToken || !a)
                throw new Error('请先完成预检');
            if (p.expiresAt && Date.parse(p.expiresAt) <= Date.now())
                throw new Error('预检已过期，请重新预检');
            const pending: PendingSubmission = {
                kind: 'CREATE', accountId: a.id, key: await requestKey(), input: this.data.input, previewToken: p.previewToken
            };
            rememberSubmission(pending);
            this.setData({
                pending
            });
            try {
                const s = await sendSubmission(pending);
                this.setData({
                    ready: false, pending: null
                });
                wx.redirectTo({
                    url: '/pages/design-detail/index?id=' + s.taskId
                });
            }
            finally {
                this.setData({
                    pending: pendingSubmission()
                });
            }
        });
    },
    async recover(e: Event) {
        await action(this, async () => {
            const p = this.data.pending;
            if (!p)
                return;
            if (e.currentTarget.dataset.resend && !await confirm('确认使用原提交键重发？不会新建不同键的重复任务。'))
                return;
            const s = await sendSubmission(p, !e.currentTarget.dataset.resend);
            this.setData({
                ready: false, pending: null
            });
            wx.redirectTo({
                url: '/pages/design-detail/index?id=' + s.taskId
            });
        });
    },
    async clearDraft() {
        if (!await confirm('清除本模式的本地草稿？'))
            return;
        saveDraft(this.data.mode, null);
        this.setData({
            input: initial(this.data.mode), preview: null, ready: false, accountId: ''
        });
        await this.load();
    }
});
