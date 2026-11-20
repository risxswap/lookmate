import { api } from '../../lib/api';
import { fileImageUrl, forgetFileImage } from '../../lib/files';
import { PagedList } from '../../lib/pagination';
import { ApiError, request } from '../../lib/request';
import { confirm, errorMessage, toast } from '../../lib/ui';
import { go, id, owner, stillOwner, value, type Event } from '../../features/page';
import type { Collection, Favorite } from '../../types/api';

type Card = Favorite & { title: string; typeLabel: string; cover: string };
type Sheet = '' | 'groups' | 'edit' | 'actions' | 'membership';
type GroupChoice = Collection & { included: boolean };

const typeLabels: Record<string, string> = { HAIRSTYLE: '发型', OUTFIT: '穿搭', OVERALL: '整体' };
const collectionPath = (collectionId: string) => '/collections/' + encodeURIComponent(collectionId);

Page({
    data: {
        items: [] as Card[],
        total: 0,
        listLoaded: false,
        listLoading: false,
        listError: '',
        hasMore: false,
        collectionId: '',
        collections: [] as Collection[],
        filters: [] as Collection[],
        groupsLoaded: false,
        groupsLoading: false,
        groupsError: '',
        groupMore: false,
        sheet: '' as Sheet,
        selected: null as Card | null,
        groupChoices: [] as GroupChoice[],
        groupName: '',
        editingId: '',
        editingVersion: '',
        latestName: null as string | null,
        versionConflict: false,
        writing: false,
        writeError: ''
    },
    rows: null as PagedList<Favorite> | null,
    groupRows: null as PagedList<Collection> | null,
    active: true,
    account: '',
    sessionRead: 0,
    listRead: 0,
    groupRead: 0,
    listRetryFirst: false,
    groupRetryFirst: false,
    go,
    onLoad() {
        this.rows = new PagedList<Favorite>();
        this.groupRows = new PagedList<Collection>();
    },
    onShow() {
        void this.refresh();
    },
    onUnload() {
        this.active = false;
    },
    async onPullDownRefresh() {
        try {
            await this.refresh();
        } finally {
            wx.stopPullDownRefresh();
        }
    },
    onReachBottom() {
        if (this.data.hasMore && !this.data.listError && !this.data.writing) void this.loadFavorites(false);
    },
    isCurrent(account: string) {
        return this.active && Boolean(account) && this.account === account && stillOwner(account);
    },
    async refresh() {
        const sessionRead = ++this.sessionRead;
        try {
            const account = await owner();
            if (!this.active || sessionRead !== this.sessionRead || !account || !stillOwner(account)) return;
            if (this.account && this.account !== account) {
                wx.reLaunch({ url: '/pages/home/index' });
                return;
            }
            this.account = account;
            await Promise.all([this.loadFavorites(true), this.loadGroups(true)]);
        } catch (error) {
            if (this.active && sessionRead === this.sessionRead && (!this.account || this.isCurrent(this.account))) {
                this.listRetryFirst = true;
                const message = errorMessage(error);
                this.setData({ listLoading: false, listError: message, groupsLoading: false, groupsError: message });
            }
        }
    },
    async loadFavorites(refresh: boolean) {
        const account = this.account;
        const rows = this.rows;
        if (!rows || !this.isCurrent(account) || (!refresh && (this.data.listLoading || !rows.hasMore))) return;
        const collectionId = this.data.collectionId;
        const read = ++this.listRead;
        this.setData({ listLoading: true, listError: '' });

        try {
            await rows.load((page, pageSize) => api.favorites(page, pageSize, collectionId), refresh);
            if (!this.isCurrent(account) || read !== this.listRead) return;
            this.listRetryFirst = false;
            const covers = new Map(this.data.items.filter(item => item.cover).map(item => [item.outputFileId, item.cover]));
            const items = rows.items.map(row => ({
                ...row,
                title: row.task.title || '设计方案',
                typeLabel: typeLabels[row.task.designType] || '设计方案',
                cover: covers.get(row.outputFileId) || ''
            }));
            this.setData({ items, total: rows.total, hasMore: rows.hasMore, listLoaded: true, listLoading: false });
            await this.loadCovers(items, account, read);
        } catch (error) {
            if (!this.isCurrent(account) || read !== this.listRead) return;
            if (collectionId && error instanceof ApiError && error.detail.code === 'COLLECTION_NOT_FOUND') {
                this.removeCollection(collectionId);
                await Promise.all([this.selectCollection(''), this.loadGroups(true)]);
                return;
            }
            this.listRetryFirst = refresh;
            this.setData({ listLoading: false, listError: errorMessage(error) });
        }
    },
    async loadCovers(items: Card[], account: string, read: number) {
        const missing = [...new Set(items.flatMap(item => item.outputFileId && !item.cover ? [item.outputFileId] : []))];
        for (let offset = 0; offset < missing.length; offset += 4) {
            if (!this.isCurrent(account) || read !== this.listRead) return;
            const ids = missing.slice(offset, offset + 4);
            const results = await Promise.allSettled(ids.map(fileId => fileImageUrl(fileId)));
            if (!this.isCurrent(account) || read !== this.listRead) return;
            const urls = new Map(results.flatMap((result, index) => result.status === 'fulfilled' ? [[ids[index], result.value] as const] : []));
            const updates: Record<string, string> = {};
            this.data.items.forEach((item, index) => {
                const cover = item.outputFileId && urls.get(item.outputFileId);
                if (!item.cover && cover) updates[`items[${index}].cover`] = cover;
            });
            if (Object.keys(updates).length) this.setData(updates);
        }
    },
    imageError(event: Event) {
        if (!this.isCurrent(this.account)) return;
        const { cover, fileId } = event.currentTarget.dataset;
        const item = this.data.items.find(item => item.id === id(event));
        if (!item || !cover || item.cover !== cover || item.outputFileId !== fileId) return;
        forgetFileImage(fileId, cover);
        this.setData({
            items: this.data.items.map(item => item.outputFileId === fileId && item.cover === cover ? { ...item, cover: '' } : item)
        });
    },
    async filter(event: Event) {
        const selectedId = id(event);
        if (this.data.writing || selectedId === this.data.collectionId || !this.isCurrent(this.account)) return;
        await this.selectCollection(selectedId);
    },
    async selectCollection(collectionId: string) {
        this.rows = new PagedList<Favorite>();
        this.listRetryFirst = true;
        this.setData({ collectionId, items: [], total: 0, listLoaded: false, hasMore: false });
        this.setCollections(this.data.collections);
        await this.loadFavorites(true);
    },
    async retryFavorites() {
        if (this.data.listLoading || this.data.writing) return;
        if (!this.account) await this.refresh();
        else await this.loadFavorites(this.listRetryFirst || !this.data.listLoaded);
    },
    async loadGroups(refresh: boolean) {
        const account = this.account;
        const rows = this.groupRows;
        if (!rows || !this.isCurrent(account) || (!refresh && (this.data.groupsLoading || !rows.hasMore))) return;
        const read = ++this.groupRead;
        this.setData({ groupsLoading: true, groupsError: '' });
        try {
            await rows.load(api.collections, refresh);
            if (!this.isCurrent(account) || read !== this.groupRead) return;
            this.groupRetryFirst = false;
            this.setCollections(rows.items);
            this.setData({ groupsLoaded: true, groupsLoading: false, groupMore: rows.hasMore });
        } catch (error) {
            if (!this.isCurrent(account) || read !== this.groupRead) return;
            this.groupRetryFirst = refresh;
            this.setData({ groupsLoading: false, groupsError: errorMessage(error) });
        }
    },
    async moreGroups() {
        if (this.data.groupsLoading || this.data.writing) return;
        if (!this.account) await this.refresh();
        else await this.loadGroups(this.groupRetryFirst || !this.data.groupsLoaded);
    },
    setCollections(collections: Collection[]) {
        const active = this.data.filters.find(group => group.id === this.data.collectionId);
        const filters = active && !collections.some(group => group.id === active.id) ? [active, ...collections] : collections;
        this.setData({ collections, filters });
        this.setChoices(this.data.selected);
    },
    setChoices(selected: Card | null) {
        const groupChoices = selected ? this.data.collections.map(group => ({
            ...group, included: selected.collectionIds.includes(group.id)
        })) : [];
        this.setData({ selected, groupChoices });
    },
    open(event: Event) {
        if (!this.isCurrent(this.account)) return;
        const item = this.data.items.find(item => item.id === id(event));
        if (item) wx.navigateTo({ url: '/pages/design-detail/index?id=' + encodeURIComponent(item.task.id) });
    },
    manage() {
        if (this.data.writing) return;
        this.setData({ sheet: 'groups', writeError: '' });
    },
    menu(event: Event) {
        const item = this.data.items.find(item => item.id === id(event));
        if (!item || this.data.writing || !this.isCurrent(this.account)) return;
        this.setChoices(item);
        this.setData({ sheet: 'actions', writeError: '' });
    },
    showMembership() {
        if (this.data.selected && !this.data.writing) this.setData({ sheet: 'membership', writeError: '' });
    },
    close() {
        if (!this.data.writing) this.dismissSheet();
    },
    dismissSheet() {
        this.setData({ sheet: '', selected: null, groupChoices: [], writeError: '' });
    },
    sheetVisibilityChanged(event: Event) {
        if (!event.detail.visible) this.close();
    },
    edit(event: Event) {
        if (this.data.writing) return;
        const group = this.data.collections.find(group => group.id === id(event));
        this.setData({
            sheet: 'edit',
            editingId: group?.id || '',
            editingVersion: group?.version || '',
            groupName: group?.name || '',
            latestName: null,
            versionConflict: false,
            writeError: ''
        });
    },
    name(event: Event) {
        this.setData({ groupName: value(event) });
    },
    cancelEdit() {
        if (!this.data.writing) this.setData({ sheet: 'groups', writeError: '' });
    },
    async write(operation: (account: string) => Promise<void>) {
        const account = this.account;
        if (!this.isCurrent(account) || this.data.writing) return;
        this.setData({ writing: true, writeError: '' });
        try {
            await operation(account);
        } catch (error) {
            if (this.isCurrent(account)) this.setData({ writeError: errorMessage(error) });
        } finally {
            if (this.isCurrent(account)) this.setData({ writing: false });
        }
    },
    async saveGroup() {
        const { editingId, editingVersion, versionConflict } = this.data;
        const groups = this.groupRows;
        if (!groups || versionConflict) return;
        const name = this.data.groupName.trim().normalize('NFC');
        await this.write(async account => {
            if (!name || [...name].length > 64) throw new Error('请输入 1 至 64 个字符的收藏夹名称');
            let saved: Collection;
            try {
                saved = await request<Collection>(editingId ? collectionPath(editingId) : '/collections', {
                    method: editingId ? 'PATCH' : 'POST',
                    body: editingId ? { name, version: editingVersion } : { name }
                });
            } catch (error) {
                if (this.isCurrent(account) && error instanceof ApiError && error.detail.code === 'VERSION_CONFLICT') {
                    this.setData({ versionConflict: true, latestName: null });
                }
                throw error;
            }
            if (!this.isCurrent(account)) return;
            if (editingId) {
                groups.items = groups.items.map(group => group.id === saved.id ? saved : group);
                this.setCollections(groups.items);
            }
            this.setData({ sheet: 'groups', groupName: '' });
            toast(editingId ? '收藏夹已改名' : '收藏夹已创建');
            if (!editingId || this.data.groupsLoading) await this.loadGroups(true);
        });
    },
    async reloadGroupVersion() {
        const editingId = this.data.editingId;
        if (!editingId || !this.data.versionConflict) return;
        await this.write(async account => {
            const group = await request<Collection>(collectionPath(editingId));
            if (!this.isCurrent(account)) return;
            this.setData({ editingVersion: group.version, latestName: group.name, versionConflict: false });
        });
    },
    removeCollection(collectionId: string) {
        const groups = this.groupRows;
        const rows = this.rows;
        if (!groups || !rows) return;
        groups.items = groups.items.filter(group => group.id !== collectionId);
        this.setCollections(groups.items);
        this.groupRetryFirst = true;
        rows.items = rows.items.map(item => ({
            ...item, collectionIds: item.collectionIds.filter(group => group !== collectionId)
        }));
        this.setData({
            items: this.data.items.map(item => ({
                ...item, collectionIds: item.collectionIds.filter(group => group !== collectionId)
            }))
        });
    },
    async deleteGroup(event: Event) {
        const group = this.data.collections.find(group => group.id === id(event));
        if (!group) return;
        await this.write(async account => {
            if (!await confirm(`删除收藏夹“${group.name}”？其中的收藏会保留。`) || !this.isCurrent(account)) return;
            await request(collectionPath(group.id), { method: 'DELETE' });
            if (!this.isCurrent(account)) return;
            this.removeCollection(group.id);
            toast('收藏夹已删除');
            await Promise.all([
                this.loadGroups(true),
                this.data.collectionId === group.id ? this.selectCollection('') :
                    this.data.listLoading ? this.loadFavorites(true) : Promise.resolve()
            ]);
        });
    },
    async unfavorite() {
        const item = this.data.selected;
        if (!item) return;
        await this.write(async account => {
            if (!await confirm('取消后将从所有收藏夹移除，设计记录会保留。', '取消收藏？') || !this.isCurrent(account)) return;
            await request('/favorites/' + encodeURIComponent(item.resultId), { method: 'DELETE' });
            if (!this.isCurrent(account)) return;
            this.dismissSheet();
            this.removeFavorite(item.id);
            toast('已取消收藏');
            await this.loadFavorites(true);
        });
    },
    async membership(event: Event) {
        const item = this.data.selected;
        const groupId = id(event);
        const rows = this.rows;
        if (!rows || !item || !this.data.collections.some(group => group.id === groupId)) return;
        const removing = item.collectionIds.includes(groupId);
        await this.write(async account => {
            await request(`${collectionPath(groupId)}/items/${encodeURIComponent(item.id)}`, {
                method: removing ? 'DELETE' : 'PUT'
            });
            if (!this.isCurrent(account)) return;
            const collectionIds = removing ? item.collectionIds.filter(id => id !== groupId) : [...item.collectionIds, groupId];
            this.setChoices({ ...item, collectionIds });
            if (removing && this.data.collectionId === groupId) {
                this.removeFavorite(item.id);
                await this.loadFavorites(true);
            } else {
                rows.items = rows.items.map(row => row.id === item.id ? { ...row, collectionIds } : row);
                this.setData({ items: this.data.items.map(row => row.id === item.id ? { ...row, collectionIds } : row) });
                if (this.data.listLoading) await this.loadFavorites(true);
            }
        });
    },
    removeFavorite(itemId: string) {
        const rows = this.rows;
        if (!rows) return;
        if (rows.items.some(row => row.id === itemId)) rows.total = Math.max(0, rows.total - 1);
        rows.items = rows.items.filter(row => row.id !== itemId);
        this.setData({ items: this.data.items.filter(row => row.id !== itemId), total: rows.total });
    }
});
