import { api } from '../../lib/api';
import { owner, stillOwner, action, today, go, value, statusLabel, isActive, type Event } from '../../features/page';
import { outfitCards } from '../../features/outfits';
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
                outfitCards(outfits.items),
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
        this.setData({ [`outfits[${Number(e.currentTarget.dataset.index)}].cover`]: '' });
    }
});
