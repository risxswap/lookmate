import { api } from '../../lib/api';
import { owner, stillOwner, action, today, go, value, statusLabel, isActive, type Event } from '../../features/page';
import { outfitCards } from '../../features/outfits';
import { fileImageUrl, forgetFileImage } from '../../lib/files';
import { ApiError, assertAccount } from '../../lib/request';
import type { OutfitPlan, TaskSummary } from '../../types/api';

type PlanCard = OutfitPlan & { cover: string };

function dateLabel(date: string): string {
    const [year, month, day] = date.split('-').map(Number);
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(year, month - 1, day).getDay()];
    const yearLabel = year === new Date().getFullYear() ? '' : `${year} 年 `;
    return `${yearLabel}${month} 月 ${day} 日 · 星期${weekday}`;
}

Page({
    data: {
        busy: false,
        loaded: false,
        error: '',
        outfitImageWarning: '',
        coverAccountId: '',
        date: today(),
        dateLabel: dateLabel(today()),
        isToday: true,
        plans: [] as PlanCard[],
        planTotal: 0,
        outfits: [] as Awaited<ReturnType<typeof outfitCards>>,
        active: null as TaskSummary | null,
        statusLabel
    },
    visible: false,
    timer: 0,
    onShow() {
        this.visible = true;
        void this.refresh();
    },
    onHide() {
        this.visible = false;
        clearTimeout(this.timer);
    },
    onUnload() {
        this.visible = false;
        clearTimeout(this.timer);
    },
    onPullDownRefresh() {
        void this.refresh().finally(() => wx.stopPullDownRefresh());
    },
    async refresh() {
        await action(this, async () => {
            const account = await owner();
            if (!account) return;
            const date = this.data.date;
            const [plans, outfits, workspace] = await Promise.all([
                api.plans(date, 1, 5),
                api.outfits(1, 4),
                api.workspace()
            ]);
            const [cards, planCards] = await Promise.all([
                outfitCards(outfits.items, ids => this.outfitCoverUrls(ids, account)),
                Promise.all(plans.items.map(async plan => ({
                    ...plan,
                    cover: plan.outfit ? (await outfitCards([plan.outfit]))[0].cover : ''
                })))
            ]);
            if (!stillOwner(account) || date !== this.data.date) return;
            this.setData({
                loaded: true,
                dateLabel: dateLabel(date),
                isToday: date === today(),
                plans: planCards,
                planTotal: plans.total,
                outfits: cards,
                active: workspace.activeTask
            });
            clearTimeout(this.timer);
            if (this.visible && workspace.activeTask && isActive(workspace.activeTask.status)) {
                this.timer = setTimeout(() => void this.refresh(), 5000);
            }
        });
    },
    async outfitCoverUrls(ids: string[], account: string): Promise<Record<string, string>> {
        const previous = new Map<string, string>();
        if (this.data.coverAccountId === account) {
            for (const outfit of this.data.outfits) {
                const fileId = outfit.sourceOutputFileId || outfit.items[0]?.imageFileIds[0];
                if (outfit.cover && fileId) previous.set(fileId, outfit.cover);
            }
        }
        let failed = false;
        const entries = await Promise.all([...new Set(ids)].filter(Boolean).map(async fileId => {
            try {
                return [fileId, previous.get(fileId) || await fileImageUrl(fileId)] as const;
            } catch (error) {
                if (error instanceof ApiError && error.detail.code === 'ACCOUNT_CHANGED') throw error;
                failed = true;
                return [fileId, ''] as const;
            }
        }));
        assertAccount(account);
        this.setData({
            coverAccountId: account,
            outfitImageWarning: failed ? '部分搭配图片加载失败，下拉刷新重试' : ''
        });
        return Object.fromEntries(entries);
    },
    changeDate(e: Event) {
        if (this.data.busy) return;
        const date = value(e);
        this.setData({ date, dateLabel: dateLabel(date), isToday: date === today(), loaded: false });
        void this.refresh();
    },
    go,
    calendar() {
        wx.navigateTo({ url: `/pages/calendar/index?date=${this.data.date}` });
    },
    task() {
        const task = this.data.active;
        if (task) {
            wx.navigateTo({
                url: task.outfitId ? `/pages/outfit-detail/index?id=${task.outfitId}` : `/pages/design-detail/index?id=${task.id}`
            });
        }
    },
    design() {
        wx.switchTab({ url: '/pages/design/index' });
    },
    planImageError(e: Event) {
        this.setData({ [`plans[${Number(e.currentTarget.dataset.index)}].cover`]: '' });
    },
    outfitImageError(e: Event) {
        const { id, fileId, cover } = e.currentTarget.dataset;
        const outfit = this.data.outfits.find(item => item.id === id && item.cover === cover);
        if (!outfit || (outfit.sourceOutputFileId || outfit.items[0]?.imageFileIds[0]) !== fileId) return;
        forgetFileImage(String(fileId), String(cover));
        this.setData({
            outfits: this.data.outfits.map(item => item.cover === cover ? { ...item, cover: '' } : item),
            outfitImageWarning: '部分搭配图片加载失败，下拉刷新重试'
        });
    }
});
