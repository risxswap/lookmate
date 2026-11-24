import { action, owner, stillOwner, statusLabel, value, id, type Event } from '../../features/page';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import type { TaskSummary } from '../../types/api';
Page({
    pager: new PagedList<TaskSummary>(),
    disposed: false,
    onLoad() {
        this.pager = new PagedList<TaskSummary>();
    },
    onUnload() { this.disposed = true; },
    data: {
        items: [] as (TaskSummary & {
            statusText: string;
        })[], scope: 'all', designType: '', status: '', total: 0, hasMore: false, busy: false, error: '', types: [
            {
                id: '', name: '全部类型'
            }, {
                id: 'HAIRSTYLE', name: '发型'
            }, {
                id: 'OUTFIT', name: '穿搭'
            }, {
                id: 'OVERALL', name: '整体'
            }
        ], statuses: [
            {
                id: '', name: '全部状态'
            }, {
                id: 'QUEUED', name: '排队中'
            }, {
                id: 'PLANNING', name: '规划中'
            }, {
                id: 'GENERATING', name: '生成中'
            }, {
                id: 'SAVING', name: '保存中'
            }, {
                id: 'SUCCEEDED', name: '成功'
            }, {
                id: 'FAILED', name: '失败'
            }, {
                id: 'UNKNOWN', name: '待确认'
            }
        ]
    },
    onShow() {
        void this.load();
    }, async onPullDownRefresh() {
        await this.load();
        wx.stopPullDownRefresh();
    }, onReachBottom() {
        void this.more();
    }, async load(refresh = true) {
        await action(this, async () => {
            const { scope, designType, status } = this.data;
            if (this.pager.selectScope(JSON.stringify([scope, designType, status]))) {
                this.setData({ items: [], total: 0, hasMore: false });
            }
            const account = await owner();
            if (!account || this.disposed) return;
            await this.pager.load((p, s) => api.designs(p, s, { scope, designType, status }), refresh);
            if (!stillOwner(account) || this.disposed) return;
            this.setData({
                items: this.pager.items.map(task => ({ ...task, statusText: statusLabel[task.status] })),
                total: this.pager.total, hasMore: this.pager.hasMore
            });
        });
    }, more() {
        return this.load(false);
    }, retry() {
        return this.load(false);
    }, async filter(e: Event) {
        if (this.data.busy) return;
        this.setData({
            [String(e.currentTarget.dataset.key)]: id(e)
        });
        await this.load();
    }, async status(e: Event) {
        if (this.data.busy) return;
        this.setData({
            status: this.data.statuses[Number(value(e))].id
        });
        await this.load();
    }, open(e: Event) {
        const t = this.data.items.find(t => t.id === id(e));
        if (t)
            wx.navigateTo({
                url: t.outfitId ? '/pages/outfit-detail/index?id=' + t.outfitId : '/pages/design-detail/index?id=' + t.id
            });
    }
});
