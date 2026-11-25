import { api } from '../../lib/api';
import { owner, stillOwner, action, today, go, value, statusLabel, isActive, type Event } from '../../features/page';
import { outfitCoverEntries, outfitCoverId, withOutfitCovers } from '../../features/outfits';
import { coverUrls, forgetFileImage } from '../../lib/files';
import { errorMessage } from '../../lib/ui';
import type { OutfitPlan, TaskSummary } from '../../types/api';

type PlanCard = OutfitPlan & { cover: string; coverFileId: string };

function planFile(plan: OutfitPlan) {
    return plan.outfit ? outfitCoverId(plan.outfit) : '';
}

function planDisplay(plans: OutfitPlan[], total: number, urls: Record<string, string>) {
    const cards = plans.map(plan => {
        const coverFileId = planFile(plan);
        return { ...plan, coverFileId, cover: urls[coverFileId] || '' };
    });
    return { plans: cards, planTotal: total, planImageWarning: cards.some(card => card.coverFileId && !card.cover) };
}

function selectedDay(date: string) {
    const [year, month, day] = date.split('-').map(Number);
    const selected = new Date(year, month - 1, day);
    const current = new Date();
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][selected.getDay()];
    const yearLabel = year === current.getFullYear() ? '' : `${year}年`;
    return {
        date,
        dateLabel: `${yearLabel}${month}月${day}日`,
        weekdayLabel: `周${weekday}`,
        isToday: selected.toDateString() === current.toDateString()
    };
}

Page({
    data: {
        busy: false,
        loaded: false,
        error: '',
        outfitImageWarning: '',
        planImageWarning: false,
        coverAccountId: '',
        ...selectedDay(today()),
        plans: [] as PlanCard[],
        planTotal: 0,
        outfits: [] as ReturnType<typeof withOutfitCovers>,
        active: null as TaskSummary | null,
        statusLabel
    },
    visible: false,
    disposed: false,
    refreshOnReturn: false,
    pollVersion: 0,
    timer: 0,
    onShow() {
        this.visible = true;
        if (this.data.busy) this.refreshOnReturn = true;
        else void this.refresh();
    },
    onHide() {
        this.visible = false;
        this.refreshOnReturn = false;
        this.stopPoll();
    },
    onUnload() {
        this.disposed = true;
        this.visible = false;
        this.refreshOnReturn = false;
        this.stopPoll();
    },
    onPullDownRefresh() {
        void this.refresh().finally(() => wx.stopPullDownRefresh());
    },
    displayedCovers(account: string): [string, string][] {
        if (account !== this.data.coverAccountId) return [];
        return [...outfitCoverEntries(this.data.outfits), ...this.data.plans.map((plan): [string, string] => [plan.coverFileId, plan.cover])];
    },
    async refresh(): Promise<void> {
        if (this.data.busy) return;
        this.stopPoll();
        await action(this, async () => {
            const account = await owner();
            if (!account) return;
            const date = this.data.date;
            const [plans, outfits, workspace] = await Promise.all([
                api.plans(date, 1, 5), api.outfits(1, 4), api.workspace()
            ]);
            const ids = [...outfits.items.map(outfitCoverId), ...plans.items.map(planFile)];
            const { urls } = await coverUrls(ids, account, this.displayedCovers(account));
            if (this.disposed || !stillOwner(account) || date !== this.data.date) return;
            const cards = withOutfitCovers(outfits.items, urls);
            this.setData({
                loaded: true, ...selectedDay(date), coverAccountId: account,
                ...planDisplay(plans.items, plans.total, urls),
                outfits: cards, active: workspace.activeTask,
                outfitImageWarning: cards.some(card => outfitCoverId(card) && !card.cover) ? '部分搭配图片加载失败，下拉刷新重试' : ''
            });
        });
        if (this.refreshOnReturn) await this.refreshAfterReturn();
        else this.schedulePoll();
    },
    async refreshAfterReturn() {
        if (!this.refreshOnReturn) return;
        this.refreshOnReturn = false;
        if (this.visible && !this.disposed && !this.data.busy) await this.refresh();
    },
    stopPoll() {
        clearTimeout(this.timer);
        this.pollVersion++;
    },
    schedulePoll() {
        this.stopPoll();
        if (!this.visible || !stillOwner(this.data.coverAccountId) || !isActive(this.data.active?.status)) return;
        const version = this.pollVersion;
        const account = this.data.coverAccountId;
        this.timer = setTimeout(() => void this.poll(account, version), 5000);
    },
    async poll(account: string, version: number) {
        if (!this.visible || version !== this.pollVersion || !stillOwner(account)) return;
        try {
            const { activeTask } = await api.workspace();
            if (this.visible && version === this.pollVersion && stillOwner(account)) this.setData({ active: activeTask });
        } catch (error) {
            if (this.visible && version === this.pollVersion && stillOwner(account)) this.setData({ error: errorMessage(error) });
            return;
        }
        if (version === this.pollVersion && stillOwner(account)) this.schedulePoll();
    },
    async changeDate(e: Event) {
        if (this.data.busy) return;
        const date = value(e);
        if (date === this.data.date) return;
        const account = this.data.coverAccountId;
        this.setData({ ...selectedDay(date), loaded: false });
        if (!account || !stillOwner(account)) { await this.refresh(); return; }
        await action(this, async () => {
            const plans = await api.plans(date, 1, 5);
            const { urls } = await coverUrls(plans.items.map(planFile), account, this.displayedCovers(account));
            if (this.disposed || !stillOwner(account) || date !== this.data.date) return;
            this.setData({ ...planDisplay(plans.items, plans.total, urls), loaded: true });
        });
        await this.refreshAfterReturn();
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
        const { id, cover } = e.currentTarget.dataset;
        const plan = this.data.plans.find(item => item.id === id && item.cover === cover);
        if (plan) this.clearCover(plan.coverFileId, plan.cover);
    },
    outfitImageError(e: Event) {
        const { id, fileId, cover } = e.currentTarget.dataset;
        const outfit = this.data.outfits.find(item => item.id === id && item.cover === cover);
        if (outfit && outfitCoverId(outfit) === fileId) this.clearCover(String(fileId), String(cover));
    },
    clearCover(fileId: string, cover: string) {
        if (!cover || !stillOwner(this.data.coverAccountId)) return;
        forgetFileImage(fileId, cover);
        const plans = this.data.plans.map(item => item.coverFileId === fileId && item.cover === cover ? { ...item, cover: '' } : item);
        const outfits = this.data.outfits.map(item => outfitCoverId(item) === fileId && item.cover === cover ? { ...item, cover: '' } : item);
        this.setData({
            plans, outfits, planImageWarning: plans.some(item => item.coverFileId && !item.cover),
            outfitImageWarning: outfits.some(item => outfitCoverId(item) && !item.cover) ? '部分搭配图片加载失败，下拉刷新重试' : ''
        });
    }
});
