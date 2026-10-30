import { request } from '../../lib/request';
import { requireAccount, getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, toast, query, errorMessage } from '../../lib/ui';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import { fileUrls } from '../../lib/files';
import type { Dress, Category, Outfit } from '../../types/api';
const pager = new PagedList<Dress>();
const outfitPager = new PagedList<Outfit>();
Page({
    data: {
        section: 'clothes', outfits: [] as (Outfit & {
            cover: string;
        })[], items: [] as (Dress & {
            cover: string;
        })[], categories: [] as Category[], categoryId: '', categoryLabel: '全部分类', total: 0, hasMore: false, error: '', busy: false
    }, go,
    onShow() {
        void this.load();
    }, async onPullDownRefresh() {
        await this.load();
        wx.stopPullDownRefresh();
    }, onReachBottom() {
        void this.more();
    },
    async load() {
        await action(this, async () => {
            if (!await owner())
                return;
            this.setData({
                categories: await api.categories()
            });
            await this.fetch(true);
        });
    }, async more() {
        await action(this, () => this.fetch(false));
    },
    async fetch(refresh: boolean) {
        if (this.data.section === 'outfits') {
            await outfitPager.load(api.outfits, refresh);
            const urls = await fileUrls(outfitPager.items.flatMap(o => o.sourceOutputFileId ? [
                o.sourceOutputFileId
            ] : o.items[0]?.imageFileIds.slice(0, 1) || []));
            this.setData({
                outfits: outfitPager.items.map(o => ({
                    ...o, cover: urls[o.sourceOutputFileId || o.items[0]?.imageFileIds[0]] || ''
                })), total: outfitPager.total, hasMore: outfitPager.hasMore
            });
            return;
        }
        await pager.load((p, s) => api.dresses(p, s, this.data.categoryId), refresh);
        const urls = await fileUrls(pager.items.flatMap(d => d.images[0] ? [
            d.images[0].fileId
        ] : []));
        this.setData({
            items: pager.items.map(d => ({
                ...d, cover: urls[d.images[0]?.fileId] || ''
            })), total: pager.total, hasMore: pager.hasMore, error: pager.error
        });
    },
    async filter(e: Event) {
        if (this.data.busy) return;
        const c = this.data.categories[Number(value(e)) - 1];
        this.setData({
            categoryId: c?.id || '', categoryLabel: c?.name || '全部分类'
        });
        await this.load();
    },
    async chooseCategory(e: Event) {
        if (this.data.busy) return;
        this.setData({
            categoryId: id(e)
        });
        await this.load();
    }, newDress() {
        wx.navigateTo({
            url: '/pages/dress-edit/index'
        });
    }, async outfits() {
        if (this.data.busy) return;
        this.setData({
            section: 'outfits'
        });
        await this.load();
    }, async clothes() {
        if (this.data.busy) return;
        this.setData({
            section: 'clothes'
        });
        await this.load();
    }
});
