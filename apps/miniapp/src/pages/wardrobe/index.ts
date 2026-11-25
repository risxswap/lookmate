import { action, owner, id, go, type Event } from '../../features/page';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import { dressMetaLabel } from '../../features/dresses';
import { coverUrls, forgetFileImage } from '../../lib/files';
import { getAccount } from '../../lib/auth';
import { assertAccount } from '../../lib/request';
import type { Dress, Category, Outfit } from '../../types/api';

const pager = new PagedList<Dress>();
const outfitPager = new PagedList<Outfit>();
type CoverPart = { fileId: string; url: string };

function outfitCoverIds(outfit: Outfit): string[] {
    if (outfit.sourceOutputFileId) return [outfit.sourceOutputFileId];
    const firstPhotos = outfit.items.map(dress => dress.imageFileIds[0]).filter(Boolean);
    return [...new Set(firstPhotos)].slice(0, 2);
}

Page({
    data: {
        section: 'clothes',
        outfits: [] as (Outfit & { coverParts: CoverPart[]; scenesText: string })[],
        items: [] as (Dress & { cover: string; metaLabel: string })[],
        categories: [] as Category[],
        categoryId: '',
        total: 0,
        hasMore: false,
        error: '',
        imageWarning: '',
        coverAccountId: '',
        busy: false
    },
    categoriesLoaded: false,
    retryAppend: false,
    go,
    onShow() {
        void this.load();
    },
    async onPullDownRefresh() {
        this.categoriesLoaded = false;
        await this.load();
        wx.stopPullDownRefresh();
    },
    onReachBottom() {
        void this.more();
    },
    async load(fromSelection = false) {
        await action(this, async () => {
            this.retryAppend = false;
            const account = getAccount()?.id;
            const knownOwner = fromSelection && account && this.data.coverAccountId === account;
            if (!knownOwner && !await owner()) return;
            if (this.data.section === 'clothes' && !this.categoriesLoaded) {
                this.setData({ categories: await api.categories() });
                this.categoriesLoaded = true;
            }
            await this.fetch(true);
        });
    },
    retry() {
        return this.retryAppend ? this.more() : this.load();
    },
    async more() {
        const current = this.data.section === 'outfits' ? outfitPager : pager;
        if (!current.hasMore) return;
        if (!current.page) return this.load();
        await action(this, async () => {
            this.retryAppend = true;
            await this.fetch(false);
        });
    },
    async coverUrls(ids: string[]): Promise<Record<string, string>> {
        const account = getAccount()?.id;
        const displayed: [string, string][] = [];
        if (this.data.coverAccountId === account) {
            for (const item of this.data.items) displayed.push([item.images[0]?.fileId || '', item.cover]);
            for (const outfit of this.data.outfits) {
                for (const part of outfit.coverParts) displayed.push([part.fileId, part.url]);
            }
        }
        const { urls, failed } = await coverUrls(ids, account, displayed);
        this.setData({ coverAccountId: account, imageWarning: failed ? '部分图片加载失败，下拉刷新重试' : '' });
        return urls;
    },
    async fetch(refresh: boolean) {
        const account = getAccount()?.id;
        if (this.data.section === 'outfits') {
            await outfitPager.load(api.outfits, refresh);
            assertAccount(account);
            const rows = outfitPager.items.map(outfit => ({ outfit, coverIds: outfitCoverIds(outfit) }));
            const urls = await this.coverUrls(rows.flatMap(row => row.coverIds));
            this.setData({
                outfits: rows.map(({ outfit, coverIds }) => ({
                    ...outfit,
                    coverParts: coverIds.filter(fileId => urls[fileId]).map(fileId => ({ fileId, url: urls[fileId] })),
                    scenesText: (outfit.scenes || []).join(' · ')
                })),
                total: outfitPager.total,
                hasMore: outfitPager.hasMore,
                error: outfitPager.error
            });
            return;
        }
        pager.selectScope(this.data.categoryId);
        await pager.load((page, pageSize) => api.dresses(page, pageSize, this.data.categoryId), refresh);
        assertAccount(account);
        const urls = await this.coverUrls(pager.items.flatMap(dress => dress.images[0] ? [dress.images[0].fileId] : []));
        const categories = new Map(this.data.categories.map(category => [category.id, category.name]));
        this.setData({
            items: pager.items.map(dress => ({
                ...dress,
                cover: urls[dress.images[0]?.fileId] || '',
                metaLabel: dressMetaLabel(dress.name, dress.color, categories.get(dress.categoryId))
            })),
            total: pager.total,
            hasMore: pager.hasMore,
            error: pager.error
        });
    },
    imageError(e: Event) {
        const { kind, cover, fileId } = e.currentTarget.dataset;
        if (!cover || !fileId || this.data.coverAccountId !== getAccount()?.id) return;
        const failedPart = (part: CoverPart) => part.fileId === fileId && part.url === cover;
        const failedDress = (item: Dress & { cover: string }) => item.images[0]?.fileId === fileId && item.cover === cover;
        const current = kind === 'outfits'
            ? this.data.outfits.some(item => item.id === id(e) && item.coverParts.some(failedPart))
            : this.data.items.some(item => item.id === id(e) && failedDress(item));
        if (!current) return;
        forgetFileImage(fileId, cover);
        this.setData({
            items: this.data.items.map(item => failedDress(item) ? { ...item, cover: '' } : item),
            outfits: this.data.outfits.map(item => ({
                ...item, coverParts: item.coverParts.filter(part => !failedPart(part))
            })),
            imageWarning: '部分图片加载失败，下拉刷新重试'
        });
    },
    async chooseCategory(e: Event) {
        const categoryId = id(e);
        if (this.data.busy || this.data.categoryId === categoryId) return;
        this.setData({ categoryId, items: [], total: 0, hasMore: false, imageWarning: '' });
        await this.load(true);
    },
    newDress() {
        wx.navigateTo({ url: '/pages/dress-edit/index' });
    },
    async outfits() {
        if (this.data.busy || this.data.section === 'outfits') return;
        this.setData({ section: 'outfits', outfits: [], total: 0, hasMore: false, imageWarning: '' });
        await this.load(true);
    },
    async clothes() {
        if (this.data.busy || this.data.section === 'clothes') return;
        this.setData({ section: 'clothes', items: [], total: 0, hasMore: false, imageWarning: '' });
        await this.load(true);
    }
});
