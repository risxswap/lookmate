import { request } from '../../lib/request';
import { requireAccount, getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, toast, query, errorMessage } from '../../lib/ui';
import { api } from '../../lib/api';
import { fileUrl, saveImage, displayUrl } from '../../lib/files';
import { requestKey, saveDraft } from '../../lib/storage';
import { pendingSubmission, rememberSubmission, sendSubmission } from '../../features/design';
import { isActive, statusLabel } from '../../features/page';
import type { DesignDetail, PendingSubmission, DesignInput, Outfit } from '../../types/api';
const labels: Record<string, string> = {
    FAVORITE: '收藏方案', UNFAVORITE: '取消收藏', RETRY_FULL: '重新规划并生成', RETRY_IMAGE: '仅重试效果图', DELETE: '删除记录', HIDE: '隐藏记录'
};
Page({
    data: {
        taskId: '', task: null as DesignDetail | null, image: '', personImage: '', referenceImages: [] as string[], canSaveOutfit: false, statusText: '', actions: [] as {
            key: string;
            label: string;
        }[], expanded: false, pending: null as PendingSubmission | null, busy: false, error: '', hairAdvice: [] as {
            label: string;
            text: string;
        }[]
    }, timer: undefined as number | undefined, visible: false,
    onLoad(q: Record<string, string | undefined>) {
        this.setData({
            taskId: q.id || ''
        });
    }, onShow() {
        this.visible = true;
        void this.load();
    }, onHide() {
        this.visible = false;
        this.stop();
    }, onUnload() {
        this.visible = false;
        this.stop();
    }, async onPullDownRefresh() {
        await this.load();
        wx.stopPullDownRefresh();
    }, stop() {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = undefined;
    },
    async load() {
        this.stop();
        await action(this, async () => {
            const account = await owner();
            if (!account)
                return;
            const task = await api.design(this.data.taskId);
            const image = task.outputFileId ? await fileUrl(task.outputFileId) : '';
            if (!stillOwner(account))
                return;
            const personImage = task.inputSummary?.personPhoto.fileId ? await fileUrl(task.inputSummary.personPhoto.fileId) : '';
            const ref = task.inputSummary?.hairstyleReference;
            const outfitRef = task.inputSummary?.outfitInspirationReference;
            const referenceImages = await Promise.all((ref ? ref.images.map(i => i.url) : outfitRef?.image ? [
                outfitRef.image.url
            ] : []).map(displayUrl));
            const hair = task.result?.hairstyle;
            const hairLabels: Record<string, string> = {
                hairstyleName: '发型', lengthAdvice: '长度', bangsAdvice: '刘海', partingAdvice: '分缝', textureAdvice: '质感', hairColorAdvice: '发色', careAdvice: '打理'
            };
            this.setData({
                task, image, personImage, referenceImages, canSaveOutfit: task.status === 'SUCCEEDED' && task.designType !== 'HAIRSTYLE' && !task.outfitId && !!task.result?.items.length, statusText: statusLabel[task.status], actions: task.actions.filter(a => labels[a]).map(key => ({
                    key, label: labels[key]
                })), pending: pendingSubmission(), hairAdvice: hair ? Object.entries(hair).map(([key, text]) => ({
                    label: hairLabels[key] || key, text
                })) : []
            });
            if (this.visible && isActive(task.status))
                this.timer = setTimeout(() => void this.load(), 4000);
        });
    },
    async saveOutfit() {
        await action(this, async () => {
            const outfit = await request<Outfit>(`/outfits/from-design/${this.data.taskId}`, {
                method: 'POST', body: {}
            });
            wx.navigateTo({
                url: '/pages/outfit-detail/index?id=' + outfit.id
            });
        });
    }, compare(e: Event) {
        const current = String(e.currentTarget.dataset.url);
        wx.previewImage({
            current, urls: [
                this.data.personImage, ...this.data.referenceImages, this.data.image
            ].filter(Boolean)
        });
    }, expand() {
        this.setData({
            expanded: !this.data.expanded
        });
    }, preview() {
        if (this.data.image)
            wx.previewImage({
                urls: [
                    this.data.image
                ]
            });
    }, async saveImage() {
        await action(this, () => saveImage(this.data.image));
    },
    async operate(e: Event) {
        const key = id(e);
        const t = this.data.task;
        if (!t?.actions.includes(key))
            return;
        if ([
            'DELETE', 'HIDE', 'UNFAVORITE', 'RETRY_FULL', 'RETRY_IMAGE'
        ].includes(key) && !await confirm(key === 'HIDE' ? '隐藏记录不会取消后台调用，确认隐藏？' : `确认${labels[key]}？`))
            return;
        await action(this, async () => {
            if (key.startsWith('RETRY')) {
                if (pendingSubmission())
                    throw new Error('请先找回待确认的提交');
                const p: PendingSubmission = {
                    kind: 'RETRY', accountId: getAccount()!.id, key: await requestKey(), sourceId: t.id, mode: key === 'RETRY_IMAGE' ? 'IMAGE_ONLY' : 'FULL'
                };
                rememberSubmission(p);
                this.setData({
                    pending: p
                });
                try {
                    const s = await sendSubmission(p);
                    wx.redirectTo({
                        url: '/pages/design-detail/index?id=' + s.taskId
                    });
                }
                finally {
                    this.setData({
                        pending: pendingSubmission()
                    });
                }
                return;
            }
            await request(key === 'FAVORITE' || key === 'UNFAVORITE' ? `/favorites/${t.resultId}` : `/designs/${t.id}${key === 'HIDE' ? '/hide' : ''}`, {
                method: key === 'FAVORITE' ? 'PUT' : key === 'HIDE' ? 'POST' : 'DELETE'
            });
            if (key === 'DELETE' || key === 'HIDE')
                wx.navigateBack();
        });
        if (!this.data.error && !key.startsWith('RETRY') && ![
            'DELETE', 'HIDE'
        ].includes(key))
            await this.load();
    },
    async recover(e: Event) {
        await action(this, async () => {
            const p = this.data.pending;
            if (!p)
                return;
            if (e.currentTarget.dataset.resend && !await confirm('使用原提交键重新发送这次重试？'))
                return;
            const s = await sendSubmission(p, !e.currentTarget.dataset.resend);
            wx.redirectTo({
                url: '/pages/design-detail/index?id=' + s.taskId
            });
        });
    },
    recreate() {
        const t = this.data.task;
        const input = t?.inputSummary?.request;
        if (!t || !input)
            return;
        saveDraft(t.designType, {
            ...input, personFileId: t.inputSummary?.personPhoto.fileId, profileVersion: t.inputSummary?.personalContext.profileVersion
        } as DesignInput);
        wx.navigateTo({
            url: '/pages/design-create/index?mode=' + t.designType
        });
    }
});
