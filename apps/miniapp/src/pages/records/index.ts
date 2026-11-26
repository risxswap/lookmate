import { action, owner, stillOwner, statusLabel, id, type Event } from '../../features/page';
import { api } from '../../lib/api';
import { coverUrls, forgetFileImage } from '../../lib/files';
import { PagedList } from '../../features/account-list';
import type { DesignRecord } from '../../types/api';

const types = [
    { id: '', name: '全部类型' }, { id: 'HAIRSTYLE', name: '发型' },
    { id: 'OUTFIT', name: '穿搭' }, { id: 'OVERALL', name: '整体' }
];
const scopes = [{ id: 'all', name: '全部任务' }, { id: 'design', name: '仅普通设计' }];
const statuses = [
    { id: '', name: '全部状态' },
    ...['QUEUED', 'PLANNING', 'GENERATING', 'SAVING', 'SUCCEEDED', 'FAILED', 'UNKNOWN']
        .map(key => ({ id: key, name: statusLabel[key] }))
];
const defaults = { scope: 'all', designType: '', status: '' };
type Filters = typeof defaults;

function dateLabel(date: Date, now: Date, yesterday: Date) {
    if (date.toDateString() === now.toDateString()) return '今天';
    if (date.toDateString() === yesterday.toDateString()) return '昨天';
    const year = date.getFullYear() === now.getFullYear() ? '' : date.getFullYear() + '年';
    return year + (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function recordRows(records: DesignRecord[], displayed: Map<string, string>) {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    let previousDate = '';
    return records.map(task => {
        const date = new Date(task.createdAt || NaN);
        const validDate = Number.isFinite(date.getTime());
        const day = validDate ? dateLabel(date, now, yesterday) : '日期未知';
        const dateHeading = day === previousDate ? '' : day;
        previousDate = day;
        const timeText = validDate ? [date.getHours(), date.getMinutes()].map(part => String(part).padStart(2, '0')).join(':') : '';
        const design = types.find(option => option.id && option.id === task.designType);
        const typeText = task.jobKind === 'EVALUATION' ? '搭配评价' : task.jobKind === 'IMAGE' ? '搭配效果图'
            : task.outfitId ? '常用搭配' : design ? design.name + '设计' : '设计任务';
        const failed = task.status === 'FAILED' || task.status === 'UNKNOWN';
        const tone = task.status === 'FAILED' ? 'failed' : task.status === 'UNKNOWN' ? 'unknown' : task.status === 'SUCCEEDED' ? 'success' : 'active';
        const outputFileId = task.status === 'SUCCEEDED' && task.jobKind !== 'EVALUATION' ? task.outputFileId || '' : '';
        return {
            ...task, dateHeading, timeText, typeText, titleText: task.title?.trim() || typeText,
            statusText: statusLabel[task.status] || '状态未知', tone,
            description: (failed ? task.errorMessage || task.summary : task.summary)?.trim() || '',
            outputFileId, cover: displayed.get(outputFileId) || ''
        };
    });
}

Page({
    pager: new PagedList<DesignRecord>(),
    disposed: false,
    coverRead: 0,
    loadedAccount: '',
    retryRefresh: true,
    onLoad() {
        this.pager = new PagedList<DesignRecord>();
    },
    onUnload() { this.disposed = true; },
    data: {
        ...defaults, types, statuses, scopes,
        draftScope: defaults.scope, draftStatus: defaults.status, filterOpen: false, filterSummary: '', hasFilters: false,
        items: [] as ReturnType<typeof recordRows>, listLoaded: false,
        total: 0, hasMore: false, busy: false, error: ''
    },
    onShow() { void this.load(); },
    async onPullDownRefresh() {
        try {
            if (!this.data.filterOpen) await this.load();
        } finally {
            wx.stopPullDownRefresh();
        }
    },
    onReachBottom() {
        if (!this.data.error && !this.data.filterOpen && this.data.hasMore) void this.more();
    },
    async load(refresh = true) {
        await action(this, async () => {
            this.retryRefresh = refresh;
            const { scope, designType, status } = this.data;
            if (this.pager.selectScope(JSON.stringify([scope, designType, status]))) {
                this.coverRead++;
                this.setData({ items: [], total: 0, hasMore: false, listLoaded: false });
            }
            const account = await owner();
            if (!account || this.disposed) return;
            await this.pager.load((page, size) => api.designs(page, size, { scope, designType, status }), refresh);
            if (!stillOwner(account) || this.disposed) return;
            const previous = this.data.items;
            const displayed = new Map(previous.filter(row => row.cover).map(row => [row.outputFileId, row.cover]));
            const items = recordRows(this.pager.items, displayed);
            this.loadedAccount = account;
            this.setData({ items, total: this.pager.total, hasMore: this.pager.hasMore, listLoaded: true });
            if (this.pager.page === 1) this.coverRead++;
            const priorIds = new Set(previous.map(row => row.id));
            const ids = items.filter(row => row.outputFileId && !row.cover && (this.pager.page === 1 || !priorIds.has(row.id)))
                .map(row => row.outputFileId);
            if (ids.length) void this.loadCovers(ids, account, this.coverRead);
        });
    },
    async loadCovers(ids: string[], account: string, read: number) {
        try {
            const { urls } = await coverUrls(ids, account, []);
            if (this.disposed || this.coverRead !== read || !stillOwner(account)) return;
            this.setData({ items: this.data.items.map(row => urls[row.outputFileId] ? { ...row, cover: urls[row.outputFileId] } : row) });
        } catch {
            // The text row stays available when its private image cannot be read.
        }
    },
    imageError(e: Event) {
        const row = this.data.items.find(item => item.id === id(e));
        const { cover: path, fileId } = e.currentTarget.dataset;
        if (!row?.cover || row.cover !== path || (fileId && fileId !== row.outputFileId) || !stillOwner(this.loadedAccount)) return;
        forgetFileImage(row.outputFileId, row.cover);
        this.setData({ items: this.data.items.map(item => item.outputFileId === row.outputFileId && item.cover === path ? { ...item, cover: '' } : item) });
    },
    more() {
        if (!this.data.busy && !this.data.filterOpen && (this.data.hasMore || this.data.error)) return this.load(Boolean(this.data.error) && this.retryRefresh);
    },
    retry() { return this.more(); },
    async changeFilters(filters: Filters) {
        if (this.data.busy) return;
        const { scope, designType, status } = filters;
        this.setData({ filterOpen: false });
        if (scope === this.data.scope && designType === this.data.designType && status === this.data.status) return;
        const filterSummary = [scope !== defaults.scope && scopes.find(option => option.id === scope)?.name, statusLabel[status]].filter(Boolean).join(' · ');
        this.setData({ ...filters, filterSummary, hasFilters: scope !== 'all' || !!designType || !!status });
        await this.load();
    },
    filter(e: Event) {
        const key = e.currentTarget.dataset.key;
        if (key !== 'scope' && key !== 'status' && key !== 'designType') return;
        const { scope, status, designType } = this.data;
        const next = id(e);
        const options = key === 'scope' ? scopes : key === 'status' ? statuses : types;
        if (options.some(option => option.id === next)) return this.changeFilters({ scope, status, designType, [key]: next });
    },
    openFilters() {
        if (!this.data.busy) this.setData({ filterOpen: true, draftScope: this.data.scope, draftStatus: this.data.status });
    },
    closeFilters(e?: Event) {
        if (e?.detail?.visible !== true) this.setData({ filterOpen: false });
    },
    pickFilter(e: Event) {
        if (!this.data.filterOpen) return;
        const choice = id(e);
        const key = e.currentTarget.dataset.key;
        if (key === 'scope' && scopes.some(option => option.id === choice)) this.setData({ draftScope: choice });
        if (key === 'status' && statuses.some(option => option.id === choice)) this.setData({ draftStatus: choice });
    },
    resetDraft() {
        this.setData({ draftScope: defaults.scope, draftStatus: defaults.status });
    },
    applyFilters() {
        if (this.data.filterOpen) return this.changeFilters({ designType: this.data.designType, scope: this.data.draftScope, status: this.data.draftStatus });
    },
    resetFilters() { return this.changeFilters(defaults); },
    startDesign() { wx.switchTab({ url: '/pages/design/index' }); },
    open(e: Event) {
        const row = this.data.items.find(item => item.id === id(e));
        if (row && stillOwner(this.loadedAccount)) wx.navigateTo({ url: row.outfitId ? '/pages/outfit-detail/index?id=' + encodeURIComponent(row.outfitId) : '/pages/design-detail/index?id=' + encodeURIComponent(row.id) });
    }
});
