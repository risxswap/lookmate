import { request } from '../../lib/request';
import { requireAccount, getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, toast, query, errorMessage } from '../../lib/ui';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import type { Collection, Favorite } from '../../types/api';
const favorites = new PagedList<Favorite>();
const groups = new PagedList<Collection>();
Page({
    data: {
        items: [] as Favorite[], collections: [] as Collection[], collectionId: '', total: 0, hasMore: false, groupMore: false, groupName: '', editingId: '', editingVersion: '', selected: null as Favorite | null, groupChoices: [] as (Collection & {
            included: boolean;
        })[], busy: false, error: ''
    }, go,
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
            await groups.load(api.collections, true);
            this.setData({
                collections: groups.items, groupMore: groups.hasMore
            });
            await this.fetch(true);
        });
    }, async more() {
        await action(this, () => this.fetch(false));
    }, async moreGroups() {
        await action(this, async () => {
            await groups.load(api.collections);
            this.setData({
                collections: groups.items, groupMore: groups.hasMore, error: groups.error
            });
        });
    }, async fetch(refresh: boolean) {
        await favorites.load((p, s) => api.favorites(p, s, this.data.collectionId), refresh);
        this.setData({
            items: favorites.items, total: favorites.total, hasMore: favorites.hasMore, error: favorites.error
        });
    }, async filter(e: Event) {
        if (this.data.busy) return;
        this.setData({
            collectionId: id(e)
        });
        await this.load();
    },
    name(e: Event) {
        this.setData({
            groupName: value(e)
        });
    }, edit(e: Event) {
        const g = this.data.collections.find(g => g.id === id(e));
        this.setData({
            editingId: g?.id || '', editingVersion: g?.version || '', groupName: g?.name || ''
        });
    },
    async saveGroup() {
        await action(this, async () => {
            if (!this.data.groupName.trim())
                throw new Error('请填写收藏夹名称');
            await request(this.data.editingId ? `/collections/${this.data.editingId}` : '/collections', {
                method: this.data.editingId ? 'PATCH' : 'POST', body: {
                    name: this.data.groupName.trim(), ...(this.data.editingId ? {
                        version: this.data.editingVersion
                    } : {})
                }
            });
            this.setData({
                editingId: '', editingVersion: '', groupName: ''
            });
        });
        if (!this.data.error)
            await this.load();
    },
    async deleteGroup(e: Event) {
        if (!await confirm('删除收藏夹？其中收藏仍会保留。'))
            return;
        await action(this, async () => {
            await request(`/collections/${id(e)}`, {
                method: 'DELETE'
            });
            if (this.data.collectionId === id(e))
                this.setData({
                    collectionId: ''
                });
        });
        if (!this.data.error)
            await this.load();
    },
    async unfavorite(e: Event) {
        const f = this.data.items.find(f => f.id === id(e));
        if (!f || !await confirm('取消收藏并移出全部收藏夹？设计记录仍保留。'))
            return;
        await action(this, async () => {
            await request(`/favorites/${f.resultId}`, {
                method: 'DELETE'
            });
        });
        if (!this.data.error)
            await this.load();
    },
    manage(e: Event) {
        const selected = this.data.items.find(f => f.id === id(e)) || null;
        this.setData({
            selected, groupChoices: this.data.collections.map(g => ({
                ...g, included: !!selected?.collectionIds.includes(g.id)
            }))
        });
    }, async close() {
        this.setData({
            selected: null
        });
        await this.load();
    },
    async membership(e: Event) {
        const f = this.data.selected;
        if (!f)
            return;
        const groupId = id(e);
        const included = f.collectionIds.includes(groupId);
        await action(this, async () => {
            await request(`/collections/${groupId}/items/${f.id}`, {
                method: included ? 'DELETE' : 'PUT'
            });
            this.setData({
                selected: {
                    ...f, collectionIds: included ? f.collectionIds.filter(v => v !== groupId) : [
                        ...f.collectionIds, groupId
                    ]
                }
            });
            this.setData({
                groupChoices: this.data.collections.map(g => ({
                    ...g, included: !!this.data.selected?.collectionIds.includes(g.id)
                }))
            });
            toast(included ? '已移出收藏夹' : '已加入收藏夹');
        });
    },
    open(e: Event) {
        const f = this.data.items.find(f => f.id === id(e));
        if (f)
            wx.navigateTo({
                url: '/pages/design-detail/index?id=' + f.task.id
            });
    }
});
