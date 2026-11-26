import { ApiError, request } from '../../lib/request';
import { action, owner, id, type Event } from '../../features/page';
import { query, toast } from '../../lib/ui';
import { api } from '../../lib/api';
import { getAccount } from '../../lib/auth';
import { PagedList } from '../../features/account-list';
import { displayUrl, forgetReferenceImage } from '../../lib/files';
import { dictionaries, type Hairstyle, type OutfitInspiration, type DesignType, type Profile } from '../../types/api';

type Reference = Hairstyle | OutfitInspiration;
type DetailImage = { id: string; label: string; url: string };
type ExampleGender = NonNullable<Profile['gender']>;
const overallExamples = {
    FEMALE: { label: '女款', src: '/assets/overall-design-example.jpg' },
    MALE: { label: '男款', src: '/assets/overall-design-example-male.jpg' }
};
const pager = new PagedList<Reference>();
const textureLabels = { STRAIGHT: '直发', WAVY: '波浪', CURLY: '卷发' };
const bangsLabels = { NONE: '无刘海', LIGHT: '轻薄', FULL: '厚刘海' };
const hairAngles = { FRONT: { label: '正面', order: 0 }, SIDE: { label: '侧面', order: 1 }, BACK: { label: '背面', order: 2 } };
const occasionLabels: Record<string, string> = { DAILY: '日常', COMMUTE: '通勤', DATE: '约会', PARTY: '聚会', TRAVEL: '出游' };
const styleLabels: Record<string, string> = { MINIMAL: '简约', CASUAL: '休闲', COMMUTE: '通勤', RETRO: '复古', SPORT_CASUAL: '运动休闲', SOFT: '温柔' };

function filterGroup(key: string, label: string, labels: Record<string, string>) {
    const options = [{ value: '', label: '全部' }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))];
    return { key, label, options, selected: 0 };
}

const initialFilters = {
    HAIRSTYLE: [
        filterGroup('length', '发长', dictionaries.hairLengths),
        filterGroup('bangs', '刘海', bangsLabels),
        filterGroup('texture', '质感', textureLabels)
    ],
    OUTFIT: [filterGroup('occasion', '场景', occasionLabels), filterGroup('style', '风格', styleLabels)],
    OVERALL: []
};

function joinAttributeLabels(labels: (string | undefined)[]) {
    return [...new Set(labels.filter(label => typeof label === 'string' && label.length > 0))].join(' · ');
}

function referenceMeta(item: Reference) {
    const labels = 'images' in item
        ? [dictionaries.hairLengths[item.length], textureLabels[item.texture]]
        : [occasionLabels[item.primaryOccasion], item.styles?.map(style => styleLabels[style]).find(Boolean)];
    return joinAttributeLabels(labels);
}

function detailAttributes(item: Reference) {
    if ('images' in item) {
        const bangs = item.bangs === 'LIGHT' ? '轻薄刘海' : bangsLabels[item.bangs];
        return joinAttributeLabels([dictionaries.hairLengths[item.length], bangs, textureLabels[item.texture]]);
    }
    const occasions = [item.primaryOccasion, ...(item.occasions ?? [])];
    return joinAttributeLabels([
        ...occasions.map(code => occasionLabels[code]),
        ...(item.styles ?? []).map(code => styleLabels[code])
    ]);
}

function referenceCover(item: Reference) {
    return 'images' in item ? item.images[0]?.url || '' : item.image?.url || '';
}

function detailSources(item: Reference): DetailImage[] {
    if (!('images' in item)) {
        return item.image?.url ? [{ id: item.image.id, label: '穿搭参考', url: item.image.url }] : [];
    }
    return item.images.filter(image => image.url)
        .sort((a, b) => (hairAngles[a.angle]?.order ?? 3) - (hairAngles[b.angle]?.order ?? 3))
        .map(image => ({ id: image.id, label: hairAngles[image.angle]?.label || '参考图', url: image.url }));
}

async function loadReferenceImage(source: string, variant: 'THUMBNAIL' | 'DISPLAY' = 'THUMBNAIL'): Promise<{ cover: string; failed: boolean }> {
    if (!source) return { cover: '', failed: false };
    try {
        return { cover: await displayUrl(source, variant), failed: false };
    } catch (error) {
        if (error instanceof ApiError && error.detail.code === 'ACCOUNT_CHANGED') throw error;
        return { cover: '', failed: true };
    }
}

Page({
    detailRead: 0,
    examplePreviewRead: 0,
    data: {
        mode: 'HAIRSTYLE' as DesignType,
        items: [] as (Reference & { cover: string; metaLabel: string })[],
        total: 0,
        hasMore: false,
        busy: false,
        error: '',
        imageWarning: '',
        detailImageWarning: '',
        scope: 'all',
        filterGroups: initialFilters.HAIRSTYLE,
        filtersOpen: false,
        filterSummary: '',
        detail: null as Reference | null,
        detailImages: [] as DetailImage[],
        detailImageIndex: 0,
        detailImagesLoading: false,
        detailAttributes: '',
        overallExamples: [] as ExampleGender[],
        overallExampleGender: 'FEMALE' as ExampleGender,
        overallExampleImages: overallExamples
    },
    onShow() {
        void this.load();
    },
    onHide() {
        this.examplePreviewRead++;
    },
    onUnload() {
        this.detailRead++;
        this.examplePreviewRead++;
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
        this.setData({
            mode, detail: null, items: [], total: 0, hasMore: false, imageWarning: '',
            filterGroups: initialFilters[mode], filterSummary: '', filtersOpen: false
        });
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
        const group = this.data.filterGroups.find(row => row.key === id(e));
        const chipIndex = e.currentTarget.dataset.index;
        const selected = Number(chipIndex ?? e.detail.value);
        if (!group?.options[selected]) return;
        if (chipIndex !== undefined) this.setData({ filtersOpen: false });
        if (group.selected === selected) return;
        this.setData({ filterGroups: this.data.filterGroups.map(row => row.key === group.key ? { ...row, selected } : row) });
        await this.load();
    },
    async load() {
        await action(this, async () => {
            try {
                if (await owner()) await this.fetch(true);
            } catch (error) {
                if (this.data.mode === 'OVERALL' && getAccount() && !(error instanceof ApiError && error.detail.code === 'ACCOUNT_CHANGED')) {
                    this.showOverallExamples(null);
                }
                throw error;
            }
        });
    },
    async more() {
        if (this.data.mode === 'OVERALL') return;
        await action(this, () => this.fetch(pager.page === 0));
    },
    async fetch(refresh: boolean) {
        if (this.data.mode === 'OVERALL') {
            this.showOverallExamples((await api.profile()).gender);
            return;
        }
        const { mode, scope, filterGroups } = this.data;
        const filters = Object.fromEntries(filterGroups.map(row => [row.key, row.options[row.selected].value]));
        const filterSummary = filterGroups.filter(row => row.selected > 0).map(row => row.options[row.selected].label).join(' · ');
        this.setData({ filterSummary });
        if (pager.selectScope(JSON.stringify([mode, scope, filters]))) {
            this.setData({ items: [], total: 0, hasMore: false, imageWarning: '' });
        }
        const list = mode === 'HAIRSTYLE' ? api.hairstyles : api.inspirations;
        await pager.load((page, pageSize) => list(page, pageSize, { scope, ...filters }), refresh);
        await this.loadCovers();
    },
    async loadCovers() {
        const loaded = await Promise.all(pager.items.map(async item => ({
            item,
            image: await loadReferenceImage(referenceCover(item))
        })));
        this.setData({
            items: loaded.map(({ item, image }) => ({ ...item, cover: image.cover, metaLabel: referenceMeta(item) })),
            total: pager.total,
            hasMore: pager.hasMore,
            error: pager.error,
            imageWarning: loaded.some(({ image }) => image.failed) ? '部分参考图片加载失败，可以重试。' : ''
        });
    },
    async retryImages() {
        if (this.data.detail) await this.loadDetailImages(this.data.detail);
        else await action(this, () => this.loadCovers());
    },
    imageError(e: Event) {
        if (e.currentTarget.dataset.mode !== this.data.mode) return;
        const failed = this.data.items.find(item => item.id === id(e) && item.cover === e.currentTarget.dataset.cover);
        if (!failed || !failed.cover) return;
        forgetReferenceImage(referenceCover(failed), failed.cover);
        this.setData({
            items: this.data.items.map(item => item === failed ? { ...item, cover: '' } : item),
            imageWarning: '部分参考图片加载失败，可以重试。'
        });
    },
    async detail(e: Event) {
        let imagesReady: Promise<void> | undefined;
        await action(this, async () => {
            const read = ++this.detailRead;
            const item = await request<Reference>(`/${this.data.mode === 'HAIRSTYLE' ? 'hairstyles' : 'outfit-inspirations'}/${id(e)}`);
            if (this.detailRead !== read) return;
            this.setData({
                detail: item, detailImages: [], detailImageIndex: 0, detailImageWarning: '',
                detailImagesLoading: false, detailAttributes: detailAttributes(item)
            });
            imagesReady = this.loadDetailImages(item);
        });
        await imagesReady;
    },
    async loadDetailImages(item: Reference) {
        if (this.data.detailImagesLoading || this.data.detail?.id !== item.id) return;
        const read = this.detailRead;
        const account = getAccount()?.id;
        const sources = detailSources(item);
        const loadedIds = new Set(this.data.detailImages.map(image => image.id));
        const missing = sources.filter(image => !loadedIds.has(image.id));
        if (!missing.length) return;
        this.setData({ detailImagesLoading: true });
        const results = await Promise.allSettled(missing.map(async image => ({ ...image, url: await displayUrl(image.url, 'DISPLAY') })));
        if (read !== this.detailRead || getAccount()?.id !== account) return;
        const ready = new Map(this.data.detailImages.map(image => [image.id, image]));
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.url) ready.set(result.value.id, result.value);
        }
        const images = sources.flatMap(image => ready.get(image.id) ?? []);
        this.showDetailImages(images, images.length < sources.length);
        this.setData({ detailImagesLoading: false });
    },
    showDetailImages(images: DetailImage[], failed: boolean) {
        const selectedId = this.data.detailImages[this.data.detailImageIndex]?.id;
        this.setData({
            detailImages: images,
            detailImageIndex: Math.max(0, images.findIndex(image => image.id === selectedId)),
            detailImageWarning: failed ? '参考图片加载失败，可以重试。' : ''
        });
    },
    selectDetailImage(e: Event) {
        const index = this.data.detailImages.findIndex(image => image.id === id(e));
        if (index >= 0 && index !== this.data.detailImageIndex) this.setData({ detailImageIndex: index });
    },
    detailImageError(e: Event) {
        const item = this.data.detail;
        if (!item) return;
        const { url } = e.currentTarget.dataset;
        const failed = this.data.detailImages.find(image => image.id === id(e) && image.url === url);
        const source = failed && detailSources(item).find(image => image.id === failed.id);
        if (!source) return;
        forgetReferenceImage(source.url, url, 'DISPLAY');
        this.showDetailImages(this.data.detailImages.filter(image => image.id !== source.id), true);
    },
    close() {
        this.detailRead++;
        this.setData({ detail: null, detailImages: [], detailImageIndex: 0, detailImagesLoading: false, detailImageWarning: '', detailAttributes: '' });
    },
    async favorite() {
        const item = this.data.detail;
        if (!item) return;
        const read = this.detailRead;
        await action(this, async () => {
            await request(`/${this.data.mode === 'HAIRSTYLE' ? 'hairstyles' : 'outfit-inspirations'}/${item.id}/favorite`, {
                method: item.favorited ? 'DELETE' : 'PUT'
            });
            const favorited = !item.favorited;
            pager.items = pager.items.map(reference => reference.id === item.id ? { ...reference, favorited } : reference);
            this.setData({
                ...(read === this.detailRead && this.data.detail?.id === item.id ? { detail: { ...item, favorited } } : {}),
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
    showOverallExamples(gender: Profile['gender']) {
        const matched = gender === 'FEMALE' || gender === 'MALE';
        this.setData({
            overallExamples: matched ? [gender] : ['FEMALE', 'MALE'],
            overallExampleGender: matched ? gender : this.data.overallExampleGender
        });
    },
    selectOverallExample(e: Event) {
        const gender = id(e) as ExampleGender;
        if (this.data.overallExamples.includes(gender)) this.setData({ overallExampleGender: gender });
    },
    previewOverallExample() {
        const gender = this.data.overallExampleGender;
        if (this.data.mode !== 'OVERALL' || !this.data.overallExamples.includes(gender)) return;
        const read = ++this.examplePreviewRead;
        const src = overallExamples[gender].src;
        const local = wx.env.USER_DATA_PATH + src.slice(src.lastIndexOf('/'));
        const current = () => read === this.examplePreviewRead && this.data.mode === 'OVERALL' && this.data.overallExampleGender === gender;
        const fail = () => { if (current()) toast('示例大图打开失败，请再试一次'); };
        const files = wx.getFileSystemManager();
        // Native preview accepts user-data files. Refresh the local copy from this build's bundled JPEG.
        files.readFile({
            filePath: src, fail,
            success: ({ data }) => {
                if (!current()) return;
                files.writeFile({
                    filePath: local, data, fail,
                    success: () => { if (current()) wx.previewImage({ current: local, urls: [local], fail }); }
                });
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
        const current = String(e.currentTarget.dataset.url);
        const urls = this.data.detailImages.map(image => image.url);
        if (urls.includes(current)) wx.previewImage({ urls, current });
    }
});
