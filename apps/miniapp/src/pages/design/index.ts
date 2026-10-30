import { request } from '../../lib/request';
import { requireAccount, getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, toast, query, errorMessage } from '../../lib/ui';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import { displayUrl } from '../../lib/files';
import type { Hairstyle, OutfitInspiration, DesignType } from '../../types/api';
const pager = new PagedList<Hairstyle | OutfitInspiration>();
const filters = {
    length: [
        '', 'SHORT', 'MEDIUM', 'LONG'
    ], bangs: [
        '', 'NONE', 'LIGHT', 'FULL'
    ], texture: [
        '', 'STRAIGHT', 'WAVY', 'CURLY'
    ]
};
Page({
    data: {
        mode: 'HAIRSTYLE' as DesignType, items: [] as ((Hairstyle | OutfitInspiration) & {
            cover: string;
        })[], total: 0, hasMore: false, busy: false, error: '', scope: 'all', length: '', bangs: '', texture: '', occasion: '', style: '', detail: null as (Hairstyle | OutfitInspiration) | null, detailImages: [] as string[], filterRows: [
            {
                key: 'length', label: '长度', values: [
                    '全部', '短发', '中长发', '长发'
                ]
            }, {
                key: 'bangs', label: '刘海', values: [
                    '全部', '无刘海', '轻薄', '厚刘海'
                ]
            }, {
                key: 'texture', label: '质感', values: [
                    '全部', '直发', '波浪', '卷发'
                ]
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
    },
    async mode(e: Event) {
        if (this.data.busy) return;
        this.setData({
            mode: id(e) as DesignType, detail: null, items: []
        });
        await this.load();
    }, async favoriteScope(e: Event) {
        if (this.data.busy) return;
        this.setData({
            scope: e.detail.value ? 'favorites' : 'all'
        });
        await this.load();
    },
    async filter(e: Event) {
        if (this.data.busy) return;
        const key = id(e) as keyof typeof filters;
        this.setData({
            [key]: filters[key][Number(value(e))]
        });
        await this.load();
    }, field(e: Event) {
        this.setData({
            [id(e)]: value(e)
        });
    },
    async load() {
        await action(this, async () => {
            if (!await owner())
                return;
            await this.fetch(true);
        });
    }, async more() {
        await action(this, () => this.fetch(false));
    }, async fetch(refresh: boolean) {
        if (this.data.mode === 'OVERALL') {
            this.setData({
                items: [], total: 0, hasMore: false
            });
            return;
        }
        await pager.load((p, s) => this.data.mode === 'HAIRSTYLE' ? api.hairstyles(p, s, {
            scope: this.data.scope, length: this.data.length, bangs: this.data.bangs, texture: this.data.texture
        }) : api.inspirations(p, s, {
            scope: this.data.scope, occasion: this.data.occasion, style: this.data.style
        }), refresh);
        const items = await Promise.all(pager.items.map(async (item) => ({
            ...item, cover: await displayUrl('images' in item ? item.images[0]?.url || '' : item.image?.url || '')
        })));
        this.setData({
            items, total: pager.total, hasMore: pager.hasMore, error: pager.error
        });
    },
    async detail(e: Event) {
        await action(this, async () => {
            const item = await request<Hairstyle | OutfitInspiration>(`/${this.data.mode === 'HAIRSTYLE' ? 'hairstyles' : 'outfit-inspirations'}/${id(e)}`);
            const urls = 'images' in item ? item.images.map(i => i.url) : item.image ? [
                item.image.url
            ] : [];
            this.setData({
                detail: item, detailImages: await Promise.all(urls.map(displayUrl))
            });
        });
    }, close() {
        this.setData({
            detail: null
        });
    },
    async favorite() {
        const item = this.data.detail;
        if (!item)
            return;
        await action(this, async () => {
            await request(`/${this.data.mode === 'HAIRSTYLE' ? 'hairstyles' : 'outfit-inspirations'}/${item.id}/favorite`, {
                method: item.favorited ? 'DELETE' : 'PUT'
            });
            this.setData({
                detail: {
                    ...item, favorited: !item.favorited
                }
            });
        });
    },
    create(e: Event) {
        const selected = e.currentTarget.dataset.reference && this.data.detail;
        wx.navigateTo({
            url: '/pages/design-create/index?' + query({
                mode: this.data.mode, ...(selected ? {
                    referenceId: selected.id, referenceVersion: selected.version
                } : {})
            })
        });
    }, preview(e: Event) {
        wx.previewImage({
            urls: this.data.detailImages, current: String(e.currentTarget.dataset.url)
        });
    }
});
