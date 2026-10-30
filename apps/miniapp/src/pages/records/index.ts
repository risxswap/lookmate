import { request } from '../../lib/request';
import { requireAccount, getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, toast, query, errorMessage } from '../../lib/ui';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import { statusLabel } from '../../features/page';
import type { TaskSummary } from '../../types/api';
const pager = new PagedList<TaskSummary>();
Page({
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
    }, async load() {
        await action(this, async () => {
            if (!await owner())
                return;
            await this.fetch(true);
        });
    }, async more() {
        await action(this, () => this.fetch(false));
    }, async fetch(refresh: boolean) {
        await pager.load((p, s) => api.designs(p, s, {
            scope: this.data.scope, designType: this.data.designType, status: this.data.status
        }), refresh);
        this.setData({
            items: pager.items.map(t => ({
                ...t, statusText: statusLabel[t.status]
            })), total: pager.total, hasMore: pager.hasMore, error: pager.error
        });
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
