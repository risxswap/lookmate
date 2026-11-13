import { ApiError, request } from '../../lib/request';
import { action, owner, value, id, type Event } from '../../features/page';
import { query } from '../../lib/ui';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import { displayUrl } from '../../lib/files';
import type { Hairstyle, OutfitInspiration, DesignType } from '../../types/api';

type Reference = Hairstyle | OutfitInspiration;
const pager = new PagedList<Reference>();
let listKey = '';
const filters = {
    length: ['', 'SHORT', 'MEDIUM', 'LONG'],
    bangs: ['', 'NONE', 'LIGHT', 'FULL'],
    texture: ['', 'STRAIGHT', 'WAVY', 'CURLY']
};

async function loadReferenceImage(source: string): Promise<{ cover: string; failed: boolean }> {
    if (!source) return { cover: '', failed: false };
    try {
        return { cover: await displayUrl(source), failed: false };
    } catch (error) {
        if (error instanceof ApiError && error.detail.code === 'ACCOUNT_CHANGED') throw error;
        return { cover: '', failed: true };
    }
}

Page({
    data: {
        mode: 'HAIRSTYLE' as DesignType,
        items: [] as (Reference & { cover: string })[],
        total: 0,
        hasMore: false,
        busy: false,
        error: '',
        imageWarning: '',
        detailImageWarning: '',
        scope: 'all',
        length: '',
        bangs: '',
        texture: '',
        occasion: '',
        style: '',
        filtersOpen: false,
        filterSummary: '',
        detail: null as Reference | null,
        detailImages: [] as string[],
        filterRows: [
            { key: 'length', label: '长度', values: ['全部', '短发', '中长发', '长发'], selected: 0 },
            { key: 'bangs', label: '刘海', values: ['全部', '无刘海', '轻薄', '厚刘海'], selected: 0 },
            { key: 'texture', label: '质感', values: ['全部', '直发', '波浪', '卷发'], selected: 0 }
        ]
    },
    onShow() {
        void this.load();
    },
    async onPullDownRefresh() {
        await this.load();
        wx.stopPullDownRefresh();
    },
    onReachBottom() {
        if (!this.data.detail) void this.more();
    },
    async mode(e: Event) {
        const mode = id(e) as DesignType;
        if (this.data.busy || mode === this.data.mode) return;
        listKey = '';
        this.setData({ mode, detail: null, items: [], total: 0, filtersOpen: false, imageWarning: '' });
        await this.load();
    },
    async favoriteScope() {
        if (this.data.busy) return;
        this.setData({ scope: this.data.scope === 'favorites' ? 'all' : 'favorites' });
        await this.load();
    },
    toggleFilters() {
        this.setData({ filtersOpen: !this.data.filtersOpen });
    },
    async filter(e: Event) {
        if (this.data.busy) return;
        const key = id(e) as keyof typeof filters;
        const selected = Number(value(e));
        this.setData({
            [key]: filters[key][selected],
            filterRows: this.data.filterRows.map(row => row.key === key ? { ...row, selected } : row)
        });
        await this.load();
    },
    field(e: Event) {
        if (this.data.busy) return;
        this.setData({ [id(e)]: value(e) });
    },
    async applyFilters() {
        await this.load();
        if (!this.data.error) this.setData({ filtersOpen: false });
    },
    async load() {
        await action(this, async () => {
            if (!await owner()) return;
            await this.fetch(true);
        });
    },
    async more() {
        await action(this, () => this.fetch(pager.page === 0));
    },
    async fetch(refresh: boolean) {
        if (this.data.mode === 'OVERALL') {
            this.setData({ items: [], total: 0, hasMore: false, filterSummary: '', imageWarning: '' });
            return;
        }
        const filterSummary = this.data.mode === 'HAIRSTYLE'
            ? this.data.filterRows.filter(row => row.selected > 0).map(row => row.values[row.selected]).join(' · ')
            : [this.data.occasion.trim(), this.data.style.trim()].filter(Boolean).join(' · ');
        this.setData({ filterSummary });
        const nextKey = JSON.stringify([
            this.data.mode, this.data.scope, this.data.length, this.data.bangs,
            this.data.texture, this.data.occasion, this.data.style
        ]);
        if (nextKey !== listKey) {
            pager.invalidate();
            pager.items = [];
            pager.page = 0;
            pager.total = 0;
            listKey = nextKey;
        }
        await pager.load((page, pageSize) => this.data.mode === 'HAIRSTYLE'
            ? api.hairstyles(page, pageSize, {
                scope: this.data.scope, length: this.data.length, bangs: this.data.bangs, texture: this.data.texture
            })
            : api.inspirations(page, pageSize, {
                scope: this.data.scope, occasion: this.data.occasion, style: this.data.style
            }), refresh);
        await this.loadCovers();
    },
    async loadCovers() {
        const loaded = await Promise.all(pager.items.map(async item => ({
            item,
            image: await loadReferenceImage('images' in item ? item.images[0]?.url || '' : item.image?.url || '')
        })));
        this.setData({
            items: loaded.map(({ item, image }) => ({ ...item, cover: image.cover })),
            total: pager.total,
            hasMore: pager.hasMore,
            error: pager.error,
            imageWarning: loaded.some(({ image }) => image.failed) ? '部分参考图片加载失败，可以重试。' : ''
        });
    },
    async retryImages() {
        await action(this, async () => {
            const item = this.data.detail;
            if (item) await this.loadDetailImages(item);
            else await this.loadCovers();
        });
    },
    imageError(e: Event) {
        if (e.currentTarget.dataset.mode !== this.data.mode) return;
        this.setData({
            items: this.data.items.map(item => item.id === id(e) && item.cover === e.currentTarget.dataset.cover
                ? { ...item, cover: '' } : item),
            imageWarning: '部分参考图片加载失败，可以重试。'
        });
    },
    async detail(e: Event) {
        await action(this, async () => {
            const item = await request<Reference>(`/${this.data.mode === 'HAIRSTYLE' ? 'hairstyles' : 'outfit-inspirations'}/${id(e)}`);
            this.setData({ detail: item, detailImages: [], detailImageWarning: '' });
            await this.loadDetailImages(item);
        });
    },
    async loadDetailImages(item: Reference) {
        const urls = 'images' in item ? item.images.map(image => image.url) : item.image ? [item.image.url] : [];
        const images = await Promise.all(urls.map(loadReferenceImage));
        this.setData({
            detailImages: images.map(image => image.cover).filter(Boolean),
            detailImageWarning: images.some(image => image.failed) ? '部分参考图片加载失败，可以重试。' : ''
        });
    },
    close() {
        this.setData({ detail: null });
    },
    async favorite() {
        const item = this.data.detail;
        if (!item) return;
        await action(this, async () => {
            await request(`/${this.data.mode === 'HAIRSTYLE' ? 'hairstyles' : 'outfit-inspirations'}/${item.id}/favorite`, {
                method: item.favorited ? 'DELETE' : 'PUT'
            });
            const favorited = !item.favorited;
            pager.items = pager.items.map(reference => reference.id === item.id ? { ...reference, favorited } : reference);
            this.setData({
                detail: { ...item, favorited },
                items: this.data.items.map(reference => reference.id === item.id ? { ...reference, favorited } : reference)
            });
            if (this.data.scope === 'favorites') {
                if (!favorited) {
                    pager.items = pager.items.filter(reference => reference.id !== item.id);
                    pager.total = Math.max(0, pager.total - 1);
                    pager.page = 0;
                    this.setData({
                        items: this.data.items.filter(reference => reference.id !== item.id),
                        total: pager.total,
                        hasMore: pager.hasMore
                    });
                }
                await this.fetch(true);
            }
        });
    },
    create(e: Event) {
        const selected = e.currentTarget.dataset.reference && this.data.detail;
        wx.navigateTo({
            url: '/pages/design-create/index?' + query({
                mode: this.data.mode,
                ...(selected ? { referenceId: selected.id, referenceVersion: selected.version } : {})
            })
        });
    },
    preview(e: Event) {
        wx.previewImage({ urls: this.data.detailImages, current: String(e.currentTarget.dataset.url) });
    }
});
