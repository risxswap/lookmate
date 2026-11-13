import { action, owner, id, go, type Event } from '../../features/page';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import { fileUrls } from '../../lib/files';
import { outfitCards } from '../../features/outfits';
import type { Dress, Category, Outfit } from '../../types/api';

const pager = new PagedList<Dress>();
const outfitPager = new PagedList<Outfit>();
let dressCategoryId = '';

Page({
    data: {
        section: 'clothes',
        outfits: [] as Awaited<ReturnType<typeof outfitCards>>,
        items: [] as (Dress & { cover: string; categoryName: string })[],
        categories: [] as Category[],
        categoryId: '',
        total: 0,
        hasMore: false,
        error: '',
        busy: false
    },
    go,
    onShow() {
        void this.load();
    },
    async onPullDownRefresh() {
        await this.load();
        wx.stopPullDownRefresh();
    },
    onReachBottom() {
        void this.more();
    },
    async load() {
        await action(this, async () => {
            if (!await owner()) return;
            this.setData({ categories: await api.categories() });
            await this.fetch(true);
        });
    },
    async more() {
        const current = this.data.section === 'outfits' ? outfitPager : pager;
        await action(this, () => this.fetch(current.page === 0));
    },
    async fetch(refresh: boolean) {
        if (this.data.section === 'outfits') {
            await outfitPager.load(api.outfits, refresh);
            this.setData({
                outfits: await outfitCards(outfitPager.items),
                total: outfitPager.total,
                hasMore: outfitPager.hasMore,
                error: outfitPager.error
            });
            return;
        }
        if (dressCategoryId !== this.data.categoryId) {
            pager.invalidate();
            pager.items = [];
            pager.page = 0;
            pager.total = 0;
            dressCategoryId = this.data.categoryId;
        }
        await pager.load((page, pageSize) => api.dresses(page, pageSize, this.data.categoryId), refresh);
        const urls = await fileUrls(pager.items.flatMap(dress => dress.images[0] ? [dress.images[0].fileId] : []));
        this.setData({
            items: pager.items.map(dress => ({
                ...dress,
                cover: urls[dress.images[0]?.fileId] || '',
                categoryName: this.data.categories.find(category => category.id === dress.categoryId)?.name || ''
            })),
            total: pager.total,
            hasMore: pager.hasMore,
            error: pager.error
        });
    },
    imageError(e: Event) {
        const key = e.currentTarget.dataset.kind === 'outfits' ? 'outfits' : 'items';
        this.setData({
            [key]: this.data[key].map(item => item.id === id(e) && item.cover === e.currentTarget.dataset.cover
                ? { ...item, cover: '' } : item)
        });
    },
    async chooseCategory(e: Event) {
        if (this.data.busy) return;
        this.setData({ categoryId: id(e) });
        await this.load();
    },
    newDress() {
        wx.navigateTo({ url: '/pages/dress-edit/index' });
    },
    async outfits() {
        if (this.data.busy) return;
        this.setData({ section: 'outfits' });
        await this.load();
    },
    async clothes() {
        if (this.data.busy) return;
        this.setData({ section: 'clothes' });
        await this.load();
    }
});
