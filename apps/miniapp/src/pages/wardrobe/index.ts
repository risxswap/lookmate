import { action, owner, id, go, type Event } from '../../features/page';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import { fileImageUrl, forgetFileImage } from '../../lib/files';
import { getAccount } from '../../lib/auth';
import { ApiError, assertAccount } from '../../lib/request';
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
        imageWarning: '',
        coverAccountId: '',
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
        await action(this, async () => {
            if (!current.hasMore) return;
            await this.fetch(current.page === 0);
        });
    },
    async coverUrls(ids: string[]): Promise<Record<string, string>> {
        const account = getAccount()?.id;
        const previous = new Map<string, string>();
        if (account && this.data.coverAccountId === account) {
            for (const item of this.data.items) {
                if (item.cover && item.images[0]) previous.set(item.images[0].fileId, item.cover);
            }
            for (const item of this.data.outfits) {
                const fileId = item.sourceOutputFileId || item.items[0]?.imageFileIds[0];
                if (item.cover && fileId) previous.set(fileId, item.cover);
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
            coverAccountId: account || '',
            imageWarning: failed ? '部分图片加载失败，下拉刷新重试' : ''
        });
        return Object.fromEntries(entries);
    },
    async fetch(refresh: boolean) {
        const account = getAccount()?.id;
        if (this.data.section === 'outfits') {
            await outfitPager.load(api.outfits, refresh);
            assertAccount(account);
            this.setData({
                outfits: await outfitCards(outfitPager.items, ids => this.coverUrls(ids)),
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
        assertAccount(account);
        const urls = await this.coverUrls(pager.items.flatMap(dress => dress.images[0] ? [dress.images[0].fileId] : []));
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
        const cover = String(e.currentTarget.dataset.cover || '');
        if (!this.data[key].some(item => item.id === id(e) && item.cover === cover)) return;
        forgetFileImage(String(e.currentTarget.dataset.fileId), cover);
        this.setData({
            items: this.data.items.map(item => item.cover === cover ? { ...item, cover: '' } : item),
            outfits: this.data.outfits.map(item => item.cover === cover ? { ...item, cover: '' } : item),
            imageWarning: '部分图片加载失败，下拉刷新重试'
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
