import { request } from '../../lib/request';
import { action, owner, stillOwner, id, isActive, statusLabel, type Event } from '../../features/page';
import { confirm } from '../../lib/ui';
import { api } from '../../lib/api';
import { fileImageUrl, forgetFileImage, saveImage, displayUrl } from '../../lib/files';
import { requestKey, saveDraft } from '../../lib/storage';
import { pendingSubmission, sendSubmission } from '../../features/design';
import type { DesignDetail, DesignInput, DesignNotice, Outfit, PendingSubmission } from '../../types/api';

const labels: Record<string, string> = {
    FAVORITE: '收藏', UNFAVORITE: '取消收藏', RETRY_FULL: '重新规划并生成',
    RETRY_IMAGE: '仅重试效果图', DELETE: '删除记录', HIDE: '隐藏记录'
};
const typeLabels: Record<string, string> = { HAIRSTYLE: '发型设计', OUTFIT: '穿搭设计', OVERALL: '整体设计' };
const stageDescriptions: Record<string, string> = {
    QUEUED: '设计任务已提交，正在等待开始。',
    PLANNING: '正在根据本次要求整理方案。',
    GENERATING: '正在根据方案生成效果图。',
    SAVING: '正在保存本次设计结果。',
    UNKNOWN: '结果尚未确认，已停止自动刷新。可以稍后手动查看。'
};
const hairLabels: Record<string, string> = {
    lengthAdvice: '长度', bangsAdvice: '刘海', partingAdvice: '分缝',
    textureAdvice: '质感', hairColorAdvice: '发色', careAdvice: '日常打理'
};
const angleLabels: Record<string, string> = { FRONT: '正面', SIDE: '侧面', BACK: '后侧' };

type PrivatePhoto = { fileId: string; url: string; status: 'loading' | 'ready' | 'error' };
type PhotoKey = 'output' | 'original';
type Reference = { id: string; label: string; source: string; url: string };
type TaskAction = { key: string; label: string };
type Notice = DesignNotice & { key: string };

function referencesFor(task: DesignDetail): Reference[] {
    const hair = task.inputSummary?.hairstyleReference;
    const outfit = task.inputSummary?.outfitInspirationReference;
    const references: Reference[] = hair ? hair.images.map(image => ({
        id: `hair-${image.id}`, source: image.url, label: `${hair.name} · ${angleLabels[image.angle] || '发型参考'}`, url: ''
    })) : [];
    if (outfit?.image) references.push({ id: `outfit-${outfit.image.id}`, source: outfit.image.url, label: outfit.name, url: '' });
    return references;
}

Page({
    data: {
        taskId: '', task: null as DesignDetail | null, metadata: '', statusText: '', statusDescription: '',
        output: null as PrivatePhoto | null, original: null as PrivatePhoto | null,
        references: [] as Reference[], referencesLoading: false, referencesError: false,
        canSaveOutfit: false, favoriteAction: '', canRecreate: false, canRefresh: false,
        retryActions: [] as TaskAction[], recordActions: [] as TaskAction[],
        detailsAvailable: false, expanded: false, showMenu: false,
        hairAdvice: [] as { label: string; text: string }[], shoeNotice: '', imageNotices: [] as Notice[], planNotices: [] as Notice[],
        pending: null as PendingSubmission | null, busy: false, error: ''
    },
    timer: undefined as number | undefined,
    visible: false,
    disposed: false,
    accountId: '',
    referenceKey: '',

    onLoad(q: Record<string, string | undefined>) {
        this.setData({ taskId: q.id || '' });
    },
    onShow() {
        this.visible = true;
        return this.load();
    },
    onHide() {
        this.visible = false;
        this.stop();
    },
    onUnload() {
        this.disposed = true;
        this.onHide();
    },
    async onPullDownRefresh() {
        try {
            await this.load();
        } finally {
            wx.stopPullDownRefresh();
        }
    },
    stop() {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    },
    schedulePoll() {
        this.stop();
        if (this.visible && isActive(this.data.task?.status)) this.timer = setTimeout(() => void this.load(), 4000);
    },
    ownsPage(account?: string) {
        const expected = account ?? this.accountId;
        return !this.disposed && !!expected && this.accountId === expected && stillOwner(expected);
    },
    async load() {
        if (this.disposed) return;
        if (this.data.busy) {
            this.schedulePoll();
            return;
        }
        this.stop();
        await action(this, async () => {
            const account = await owner();
            if (!account || this.disposed) return;
            const task = await api.design(this.data.taskId);
            if (!stillOwner(account) || this.disposed) return;
            this.accountId = account;
            this.showTask(task);
        });
        if (this.ownsPage()) this.schedulePoll();
    },
    showTask(task: DesignDetail) {
        const result = task.result;
        const input = task.inputSummary?.request;
        const metadata = [typeLabels[task.designType], result?.occasion || input?.occasion, result?.style || input?.style];
        const available = task.actions;
        const hair = result?.hairstyle;
        const shoeDescription = result?.illustrativeShoes?.description;
        const notices = (result?.notices || []).map((notice, index) => ({ ...notice, key: `${notice.code}-${index}` }));
        const hasShoeNotice = notices.some(notice => notice.code === 'ILLUSTRATIVE_SHOES');
        this.setData({
            task, metadata: [...new Set(metadata.filter(Boolean))].join(' · '), statusText: statusLabel[task.status],
            statusDescription: stageDescriptions[task.status] || '', pending: pendingSubmission(),
            canSaveOutfit: task.status === 'SUCCEEDED' && task.designType !== 'HAIRSTYLE' && !task.outfitId && !!result?.items?.length,
            favoriteAction: task.resultId ? available.find(key => key === 'FAVORITE' || key === 'UNFAVORITE') || '' : '',
            canRecreate: !!input && available.includes('NEW_FROM_INPUT'), canRefresh: available.includes('REFRESH'),
            retryActions: available.filter(key => key === 'RETRY_FULL' || key === 'RETRY_IMAGE').map(key => ({ key, label: labels[key] })),
            recordActions: available.filter(key => key === 'DELETE' || key === 'HIDE').map(key => ({ key, label: labels[key] })),
            detailsAvailable: !!(result?.designReason || result?.colorAdvice || result?.items?.some(item => item.matchReason)
                || result?.inspirationAdaptation?.borrowedElements.length || result?.inspirationAdaptation?.differences.length),
            hairAdvice: hair ? Object.entries(hairLabels).flatMap(([field, label]) => {
                const text = hair[field as keyof typeof hair];
                return text ? [{ label, text }] : [];
            }) : [],
            imageNotices: notices.filter(notice => notice.placement === 'NEAR_IMAGE'),
            planNotices: notices.filter(notice => notice.placement !== 'NEAR_IMAGE'),
            shoeNotice: result?.illustrativeShoes
                ? hasShoeNotice ? shoeDescription || '' : ['鞋子为 AI 生成示意，非衣橱单品', shoeDescription].filter(Boolean).join('。')
                : ''
        });
        if (this.data.output?.fileId !== (task.outputFileId || undefined))
            void this.loadPhoto('output', task.outputFileId);
        if (this.data.original?.fileId !== (task.inputSummary?.personPhoto?.fileId || undefined))
            void this.loadPhoto('original', task.inputSummary?.personPhoto?.fileId);
        const references = referencesFor(task);
        const key = JSON.stringify(references);
        if (this.referenceKey !== key) {
            this.referenceKey = key;
            void this.loadReferences(references);
        }
    },
    async loadPhoto(key: PhotoKey, fileId?: string | null) {
        const account = this.accountId;
        if (!this.ownsPage(account)) return;
        this.setData({ [key]: fileId ? { fileId, url: '', status: 'loading' } : null });
        if (!fileId) return;
        let url = '';
        try { url = await fileImageUrl(fileId, 'DISPLAY'); } catch { /* The task and other photos remain available. */ }
        if (this.ownsPage(account) && this.data[key]?.fileId === fileId)
            this.setData({ [key]: { fileId, url, status: url ? 'ready' : 'error' } });
    },
    async loadReferences(references: Reference[]) {
        const account = this.accountId;
        const key = this.referenceKey;
        if (!this.ownsPage(account)) return;
        this.setData({ references, referencesLoading: references.some(reference => !reference.url), referencesError: false });
        const loaded = await Promise.all(references.map(async reference => {
            if (reference.url) return reference;
            try { return { ...reference, url: await displayUrl(reference.source, 'DISPLAY') }; }
            catch { return reference; }
        }));
        if (this.ownsPage(account) && key === this.referenceKey)
            this.setData({ references: loaded, referencesLoading: false, referencesError: loaded.some(reference => !reference.url) });
    },
    imageError(event: Event) {
        const photo = this.data.output;
        if (!photo?.url || photo.url !== event.currentTarget.dataset.src || !this.ownsPage()) return;
        forgetFileImage(photo.fileId, photo.url, 'DISPLAY');
        this.setData({ output: { ...photo, url: '', status: 'error' } });
    },
    retryImage() {
        const photo = this.data.output;
        if (photo?.status === 'error') return this.loadPhoto('output', photo.fileId);
    },
    retryReferences() {
        if (this.data.referencesError && !this.data.referencesLoading) return this.loadReferences(this.data.references);
    },
    previewPhoto(current?: string) {
        if (!current || !this.ownsPage()) return;
        const urls = [this.data.output?.url, this.data.original?.url].filter((url): url is string => !!url);
        wx.previewImage({ current, urls: [...new Set(urls)] });
    },
    previewOutput() {
        this.previewPhoto(this.data.output?.url);
    },
    previewOriginal() {
        const photo = this.data.original;
        if (photo?.status === 'error') return this.loadPhoto('original', photo.fileId);
        this.previewPhoto(photo?.url);
    },
    previewReference(event: Event) {
        if (!this.ownsPage()) return;
        const current = this.data.references.find(reference => reference.id === id(event))?.url;
        if (current) wx.previewImage({ current, urls: [...new Set(this.data.references.map(reference => reference.url).filter(Boolean))] });
    },
    expand() {
        this.setData({ expanded: !this.data.expanded });
    },
    openMenu() {
        if (this.ownsPage()) this.setData({ showMenu: true });
    },
    closeMenu() {
        this.setData({ showMenu: false });
    },
    menuVisibilityChanged(event: Event) {
        if (event.detail.visible === false) this.closeMenu();
    },
    async saveImage() {
        const url = this.data.output?.url;
        if (!url || !this.ownsPage() || this.data.busy) return;
        this.closeMenu();
        await action(this, () => saveImage(url));
    },
    async saveOutfit() {
        const task = this.data.task;
        const account = this.accountId;
        if (!task || !this.data.canSaveOutfit || !this.ownsPage(account)) return;
        await action(this, async () => {
            const outfit = await request<Outfit>(`/outfits/from-design/${encodeURIComponent(task.id)}`, { method: 'POST', body: {} });
            if (this.ownsPage(account)) wx.navigateTo({ url: '/pages/outfit-detail/index?id=' + encodeURIComponent(outfit.id) });
        });
    },
    async operate(event: Event) {
        const key = id(event);
        const task = this.data.task;
        const account = this.accountId;
        if (!task?.actions.includes(key) || !labels[key] || !this.ownsPage(account) || this.data.busy || this.data.pending) return;
        this.closeMenu();
        let refresh = false;
        await action(this, async () => {
            if (key !== 'FAVORITE' && !await confirm(key === 'HIDE' ? '隐藏记录不会取消后台调用，确认隐藏？' : `确认${labels[key]}？`)) return;
            if (!this.ownsPage(account)) return;
            if (key === 'RETRY_IMAGE' || key === 'RETRY_FULL') {
                if (pendingSubmission()) throw new Error('请先找回待确认的提交');
                const pending: PendingSubmission = {
                    kind: 'RETRY', accountId: account, key: await requestKey(), sourceId: task.id,
                    mode: key === 'RETRY_IMAGE' ? 'IMAGE_ONLY' : 'FULL'
                };
                if (!this.ownsPage(account)) return;
                this.setData({ pending });
                try {
                    const submission = await sendSubmission(pending);
                    if (this.ownsPage(account)) wx.redirectTo({ url: '/pages/design-detail/index?id=' + encodeURIComponent(submission.taskId) });
                } finally {
                    if (this.ownsPage(account)) this.setData({ pending: pendingSubmission() });
                }
                return;
            }
            if (key === 'FAVORITE' || key === 'UNFAVORITE') {
                if (!task.resultId) return;
                await request(`/favorites/${encodeURIComponent(task.resultId)}`, { method: key === 'FAVORITE' ? 'PUT' : 'DELETE' });
                refresh = true;
                return;
            }
            await request(`/designs/${encodeURIComponent(task.id)}${key === 'HIDE' ? '/hide' : ''}`, { method: key === 'HIDE' ? 'POST' : 'DELETE' });
            if (this.ownsPage(account)) wx.navigateBack();
        });
        if (refresh && this.ownsPage(account)) await this.load();
    },
    async recover(event: Event) {
        const account = this.accountId;
        if (!this.ownsPage(account)) return;
        await action(this, async () => {
            const pending = pendingSubmission();
            if (!pending) return;
            const resend = !!event.currentTarget.dataset.resend;
            if (resend && !await confirm('使用原提交键重新发送本次提交？')) return;
            if (!this.ownsPage(account)) return;
            try {
                const submission = await sendSubmission(pending, !resend);
                if (this.ownsPage(account)) wx.redirectTo({ url: '/pages/design-detail/index?id=' + encodeURIComponent(submission.taskId) });
            } finally {
                if (this.ownsPage(account)) this.setData({ pending: pendingSubmission() });
            }
        });
    },
    recreate() {
        const task = this.data.task;
        const summary = task?.inputSummary;
        if (!task || !summary?.request || !this.data.canRecreate || !this.ownsPage() || this.data.busy) return;
        this.closeMenu();
        saveDraft(task.designType, {
            ...summary.request, personFileId: summary.personPhoto?.fileId, profileVersion: summary.personalContext?.profileVersion
        } as DesignInput);
        wx.navigateTo({ url: '/pages/design-create/index?mode=' + encodeURIComponent(task.designType) });
    }
});
