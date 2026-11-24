import { api } from '../../lib/api';
import { ApiError, request } from '../../lib/request';
import { PagedList } from '../../lib/pagination';
import { fileUrls, fileUrl, fileImageUrl, forgetFileImage, saveImage } from '../../lib/files';
import { readStored, writeStored, requestKey } from '../../lib/storage';
import { confirm, toast, errorMessage } from '../../lib/ui';
import { owner, stillOwner, action, type Event, value, id, go, statusLabel, isActive } from '../../features/page';
import { currentJobs, submitJob, recoverJob, assertAccount, saveOutfit, outfitIsDirty, sameMembers, sceneNames, type PendingJob } from '../../features/outfits';
import type { Outfit, OutfitGroup, Dress, Photo, OutfitJob } from '../../types/api';

type Item = { id: string; name: string; missing: boolean; cover: string };
type HistoryJob = OutfitJob & { id: string };

function lists() {
    return {
        dresses: new PagedList<Dress>(), groups: new PagedList<OutfitGroup>(),
        photos: new PagedList<Photo>(), jobs: new PagedList<HistoryJob>(5)
    };
}

function outfitItems(outfit: Outfit, covers?: ReadonlyMap<string, string>): Item[] {
    return outfit.items.map(item => ({
        id: item.dressId, name: item.dressName, missing: item.missing, cover: covers?.get(item.imageFileIds[0]) || ''
    }));
}

function form(outfit: Outfit, items: Item[]) {
    return {
        name: outfit.name, note: outfit.note || '', pinned: outfit.pinned,
        scenes: (outfit.scenes || []).join('、'), groupIds: outfit.groups.map(group => group.id),
        dressIds: items.map(item => item.id), selectedItems: items,
        collageItems: items.slice(0, 4), hasMissing: items.some(item => item.missing)
    };
}

function sameRevision(job: OutfitJob | null, outfit: Outfit): OutfitJob | null {
    return job && !job.stale && job.revision === outfit.revision && job.outfitId === outfit.id ? job : null;
}

function latestState(job: OutfitJob | null) {
    return {
        latestJob: job, processing: isActive(job?.status),
        latestRetryFull: !!job?.actions.includes('RETRY_FULL'),
        latestRetryImage: !!job?.actions.includes('RETRY_IMAGE')
    };
}

const closedPickers = { showGroups: false, showDresses: false, showPhotos: false, personFileId: '' };
const closedHistory = { showHistory: false, selectedJob: null, jobImage: '', retryFull: false, retryImage: false, sourceHistoryImage: '' };

Page({
    data: {
        busy: false, error: '', editing: false, outfitId: '', outfit: null as Outfit | null,
        name: '', note: '', pinned: false, scenes: '', dressIds: [] as string[], groupIds: [] as string[],
        selectedItems: [] as Item[], collageItems: [] as Item[], hasMissing: false,
        heroFileId: '', heroImage: '', imageError: '', checkingCurrent: false,
        dresses: [] as (Dress & { selected: boolean; cover: string })[], dressMore: false,
        groups: [] as (OutfitGroup & { selected: boolean })[], groupMore: false,
        photos: [] as (Photo & { selected: boolean; cover: string })[], photoMore: false,
        ...closedPickers, showAdvice: false, evaluation: null as OutfitJob | null,
        ...latestState(null), ...closedHistory, selectedJob: null as OutfitJob | null,
        jobs: [] as (OutfitJob & { label: string })[], jobMore: false, pending: false, canResend: false, statusLabel
    },
    lists: {} as ReturnType<typeof lists>, savedItems: [] as Item[], visible: false, disposed: false, visibilityVersion: 0, timer: 0, account: '',
    onLoad(query: Record<string, string>) {
        this.lists = lists();
        this.savedItems = [];
        this.setData({ outfitId: query.id || '', editing: !query.id });
    },
    onShow() {
        this.visible = true;
        void this.refresh();
    },
    onHide() {
        this.visibilityVersion++;
        this.visible = false;
        clearTimeout(this.timer);
    },
    onUnload() {
        this.disposed = true;
        this.visible = false;
        clearTimeout(this.timer);
    },
    onPullDownRefresh() {
        void this.refresh().finally(() => wx.stopPullDownRefresh());
    },
    onReachBottom() {
        if (this.data.showHistory && this.data.jobMore) void this.moreJobs();
    },
    go,
    async refresh() {
        await action(this, async () => {
            const account = await owner();
            if (!account || this.disposed) return;
            this.account = account;
            if (!this.data.outfitId || (this.data.editing && this.data.outfit)) return;
            await this.readOutfit();
            if (this.data.showHistory) await this.readHistory(true);
            if (this.data.pending) await this.findPending();
        });
        this.schedulePoll();
    },
    async readOutfit() {
        const outfit = await api.outfit(this.data.outfitId);
        assertAccount(this.account);
        if (this.disposed) return;
        const previous = this.data.outfit;
        const pending = !!readStored<PendingJob>(`outfit-job:${outfit.id}`, this.account);
        const sameOutfit = !this.data.editing && JSON.stringify(previous) === JSON.stringify(outfit);
        const missingCover = outfit.items.some((item, index) => item.imageFileIds.length && !this.savedItems[index]?.cover);
        if (sameOutfit && !missingCover) {
            // Native image previews can resume this page without changing the displayed outfit.
            if (pending !== this.data.pending) this.setData({ pending });
            await this.readCurrent();
            return;
        }
        const changed = previous?.revision !== outfit.revision;
        this.setData({
            outfit, outfitId: outfit.id, pending,
            ...(changed ? { ...this.newRevisionState(), ...form(outfit, outfitItems(outfit)) } : {})
        });
        // Resolve the current result independently of the number of thumbnails in the outfit.
        const results = await Promise.allSettled([this.readCurrent(), this.fill(outfit)]);
        for (const result of results) {
            if (result.status === 'rejected') throw result.reason;
        }
    },
    newRevisionState() {
        return {
            checkingCurrent: true, heroFileId: '', heroImage: '', imageError: '', evaluation: null,
            ...latestState(null), ...closedHistory, showAdvice: false, jobs: [], jobMore: false
        };
    },
    async itemImageUrls(outfit: Outfit, variant: 'THUMBNAIL' | 'DISPLAY') {
        const fileIds = [...new Set(outfit.items.flatMap(item => item.imageFileIds.slice(0, 1)))];
        const urls = new Map<string, string>();
        const visibility = this.visibilityVersion;
        // Leave request capacity for other images in larger outfits.
        for (let offset = 0; offset < fileIds.length; offset += 4) {
            assertAccount(this.account);
            if (this.disposed || (variant === 'DISPLAY' && visibility !== this.visibilityVersion)) break;
            await Promise.all(fileIds.slice(offset, offset + 4).map(async fileId => {
                const image = variant === 'THUMBNAIL' ? fileImageUrl(fileId) : fileUrl(fileId, variant);
                const url = await image.catch(() => '');
                urls.set(fileId, url);
            }));
        }
        return urls;
    },
    async fill(outfit: Outfit) {
        const covers = await this.itemImageUrls(outfit, 'THUMBNAIL');
        assertAccount(this.account);
        if (this.disposed) return;
        const items = outfitItems(outfit, covers);
        this.savedItems = items;
        const changed = this.data.outfit?.revision !== outfit.revision;
        this.setData({
            outfit, outfitId: outfit.id, ...form(outfit, items),
            ...(changed ? this.newRevisionState() : {})
        });
    },
    itemCoverFailed(e: Event) {
        const cover = e.currentTarget.dataset.src;
        const itemId = id(e);
        const saved = this.savedItems.find(item => item.id === itemId);
        const fileId = this.data.outfit?.items.find(item => item.dressId === itemId)?.imageFileIds[0];
        if (!stillOwner(this.account) || !fileId || !saved || !cover || saved.cover !== cover) return;
        forgetFileImage(fileId, cover);
        const withoutCover = (item: Item) => item.id === itemId && item.cover === cover ? { ...item, cover: '' } : item;
        this.savedItems = this.savedItems.map(withoutCover);
        this.setData({
            selectedItems: this.data.selectedItems.map(withoutCover),
            collageItems: this.data.collageItems.map(withoutCover)
        });
    },
    startEdit() {
        if (this.data.busy || !this.data.outfit) return;
        clearTimeout(this.timer);
        this.setData({ editing: true, error: '', ...closedPickers, ...closedHistory });
        wx.pageScrollTo?.({ scrollTop: 0, duration: 0 });
    },
    async cancelEdit() {
        const outfit = this.data.outfit;
        if (this.data.busy || !this.data.editing) return;
        if (outfit && outfitIsDirty(outfit, this.data) && !await confirm('放弃这次修改？')) return;
        if (!outfit) {
            wx.navigateBack();
            return;
        }
        this.setData({ ...form(outfit, this.savedItems), ...closedPickers, editing: false, error: '' });
        wx.pageScrollTo?.({ scrollTop: 0, duration: 0 });
        await this.refresh();
    },
    async reloadEditor() {
        if (this.data.busy || !this.data.outfitId || !await confirm('重新载入搭配并放弃未保存的修改？')) return;
        await action(this, async () => {
            await this.readOutfit();
            this.setData({ ...closedPickers });
        });
    },
    field(e: Event) { this.setData({ [String(e.currentTarget.dataset.field)]: value(e) }); },
    pin(e: Event) { this.setData({ pinned: !!e.detail.value }); },
    async chooseDresses() {
        if (this.data.busy) return;
        this.setData({ showDresses: !this.data.showDresses });
        if (this.data.showDresses) await this.loadDresses(true);
    },
    async loadDresses(refresh = false) {
        await action(this, async () => {
            const list = this.lists.dresses;
            await list.load(api.dresses, refresh);
            const covers = await fileUrls(list.items.flatMap(dress => dress.images.slice(0, 1).map(image => image.fileId)));
            this.setData({
                dresses: list.items.map(dress => ({ ...dress, cover: covers[dress.images[0]?.fileId] || '', selected: this.data.dressIds.includes(dress.id) })),
                dressMore: list.hasMore
            });
        });
    },
    moreDresses() { return this.loadDresses(); },
    toggleDress(e: Event) {
        if (this.data.busy) return;
        const key = id(e);
        let items = this.data.selectedItems.filter(item => item.id !== key);
        if (items.length === this.data.selectedItems.length) {
            if (items.length >= 32) { toast('一套搭配最多 32 件单品'); return; }
            const dress = this.data.dresses.find(item => item.id === key);
            if (!dress) return;
            items = [...items, { id: key, name: dress.name, missing: false, cover: dress.cover }];
        }
        const ids = items.map(item => item.id);
        this.setData({ dressIds: ids, selectedItems: items, dresses: this.data.dresses.map(dress => ({ ...dress, selected: ids.includes(dress.id) })) });
    },
    async chooseGroups() {
        if (this.data.busy) return;
        this.setData({ showGroups: !this.data.showGroups });
        if (this.data.showGroups) await this.loadGroups(true);
    },
    async loadGroups(refresh = false) {
        await action(this, async () => {
            const groups = this.lists.groups;
            await groups.load(api.outfitGroups, refresh);
            this.setData({ groups: groups.items.map(group => ({ ...group, selected: this.data.groupIds.includes(group.id) })), groupMore: groups.hasMore });
        });
    },
    moreGroups() { return this.loadGroups(); },
    toggleGroup(e: Event) {
        if (this.data.busy) return;
        const key = id(e);
        const ids = this.data.groupIds.includes(key) ? this.data.groupIds.filter(v => v !== key) : [...this.data.groupIds, key];
        if (ids.length > 20) { toast('最多选择 20 个分组'); return; }
        this.setData({ groupIds: ids, groups: this.data.groups.map(group => ({ ...group, selected: ids.includes(group.id) })) });
    },
    async save() {
        await action(this, async () => {
            assertAccount(this.account);
            const name = this.data.name.trim();
            if (!name || !this.data.dressIds.length) throw new Error('请填写名称并选择至少一件衣物');
            const scenes = sceneNames(this.data.scenes);
            if (scenes.length > 20 || scenes.some(scene => Array.from(scene).length > 20)) throw new Error('最多 20 个场景，每个不超过 20 字');
            let saved = await saveOutfit(this.data, this.data.outfit);
            assertAccount(this.account);
            if (this.disposed) return;
            // The base write may succeed even when the subsequent scene write fails.
            await this.fill(saved);
            this.setData({ scenes: scenes.join('、') });
            if (!sameMembers(scenes, saved.scenes || [])) {
                saved = await request<Outfit>(`/outfits/${saved.id}/scenes`, { method: 'PUT', body: { version: saved.version, scenes } });
                assertAccount(this.account);
                this.setData({ outfit: saved, scenes: (saved.scenes || []).join('、') });
            }
            this.setData({ ...closedPickers, ...closedHistory, editing: false });
            wx.pageScrollTo?.({ scrollTop: 0, duration: 0 });
            toast('搭配已保存');
            await this.readCurrent();
        });
        this.schedulePoll();
    },
    async remove() {
        const outfit = this.data.outfit;
        if (!outfit || this.data.busy || !await confirm('删除这套常用搭配？已有穿搭安排仍保留快照。')) return;
        await action(this, async () => {
            assertAccount(this.account);
            await request(`/outfits/${outfit.id}?version=${outfit.version}`, { method: 'DELETE' });
            wx.navigateBack();
        });
    },
    calendar() { wx.navigateTo({ url: `/pages/calendar/index?outfitId=${this.data.outfitId}` }); },
    async choosePhotos() {
        if (this.data.busy || this.data.pending || this.data.processing) return;
        this.setData({ showPhotos: !this.data.showPhotos, personFileId: '' });
        if (this.data.showPhotos) await this.loadPhotos(true);
    },
    async loadPhotos(refresh = false) {
        await action(this, async () => {
            const list = this.lists.photos;
            await list.load(api.photos, refresh);
            const photos = list.items.filter(photo => photo.photoType === 'FULL_BODY');
            const covers = await fileUrls(photos.map(photo => photo.fileId));
            this.setData({
                photos: photos.map(photo => ({ ...photo, cover: covers[photo.fileId], selected: photo.fileId === this.data.personFileId })),
                photoMore: list.hasMore
            });
        });
    },
    morePhotos() { return this.loadPhotos(); },
    selectPhoto(e: Event) {
        const key = id(e);
        this.setData({ personFileId: key, photos: this.data.photos.map(photo => ({ ...photo, selected: photo.fileId === key })) });
    },
    async generate(e: Event) {
        if (this.data.pending || this.data.processing) return;
        const kind = e.currentTarget.dataset.kind as 'IMAGE' | 'EVALUATION';
        await action(this, async () => {
            assertAccount(this.account);
            const outfit = this.data.outfit;
            if (!outfit) throw new Error('请先保存搭配');
            if (outfitIsDirty(outfit, this.data)) throw new Error('搭配有未保存的修改，请先保存后再发起 AI 任务');
            if (kind === 'IMAGE' && !this.data.personFileId) throw new Error('请先选择本人的全身照');
            await this.execute({
                key: await requestKey(), outfitId: outfit.id,
                body: { kind, revision: outfit.revision, ...(kind === 'IMAGE' ? { personFileId: this.data.personFileId } : {}) }
            });
        });
        this.schedulePoll();
    },
    async execute(pending: PendingJob) {
        assertAccount(this.account);
        const storage = `outfit-job:${pending.outfitId}`;
        writeStored(storage, pending, this.account);
        this.setData({ pending: true, canResend: false });
        let job: OutfitJob;
        try {
            job = await submitJob(pending);
        } catch (error) {
            if (stillOwner(this.account) && error instanceof ApiError && error.status >= 400 && error.status < 500
                    && error.status !== 408 && error.detail.code !== 'IDEMPOTENCY_CONFLICT') {
                writeStored(storage, null, this.account);
                this.setData({ pending: false });
            }
            throw error;
        }
        await this.acceptJob(job, pending);
    },
    async acceptJob(job: OutfitJob, pending: PendingJob) {
        assertAccount(this.account);
        writeStored(`outfit-job:${pending.outfitId}`, null, this.account);
        if (this.disposed) return;
        this.setData({ pending: false, canResend: false, showPhotos: false, personFileId: '' });
        if (this.data.outfit && sameRevision(job, this.data.outfit)) {
            this.setData(latestState(job));
        } else if (job.stale && this.data.showHistory) {
            await this.showJob(job);
        }
        await this.readCurrent();
        if (this.data.showHistory) await this.readHistory(true);
    },
    async findPending() {
        const pending = readStored<PendingJob>(`outfit-job:${this.data.outfitId}`, this.account);
        if (!pending) return;
        let job: OutfitJob;
        try {
            job = await recoverJob(pending.key);
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
                this.setData({ canResend: true });
                throw new Error('暂未找到任务，可稍后查询或明确使用原提交键重发。');
            }
            throw error;
        }
        await this.acceptJob(job, pending);
    },
    async recover() {
        await action(this, () => this.findPending());
        this.schedulePoll();
    },
    async resend() {
        if (this.data.busy || !this.data.canResend || !await confirm('使用相同提交键和原请求重发？服务端会避免重复创建任务。')) return;
        await action(this, async () => {
            const pending = readStored<PendingJob>(`outfit-job:${this.data.outfitId}`, this.account);
            if (pending) await this.execute(pending);
        });
        this.schedulePoll();
    },
    async retry(e: Event) {
        if (this.data.pending || this.data.processing) return;
        const job = e.currentTarget.dataset.target === 'latest' ? this.data.latestJob : this.data.selectedJob;
        const mode = e.currentTarget.dataset.mode as 'FULL' | 'IMAGE_ONLY';
        if (!job || !job.actions.includes(mode === 'FULL' ? 'RETRY_FULL' : 'RETRY_IMAGE')) return;
        await action(this, async () => {
            await this.execute({ key: await requestKey(), outfitId: this.data.outfitId, sourceId: job.taskId, body: { mode } });
        });
        this.schedulePoll();
    },
    async readCurrent() {
        const outfit = this.data.outfit;
        if (!outfit) return;
        let current: Awaited<ReturnType<typeof currentJobs>>;
        try {
            current = await currentJobs(outfit.id);
        } catch (error) {
            if (this.data.checkingCurrent) this.setData({ imageError: errorMessage(error) });
            throw error;
        }
        assertAccount(this.account);
        if (this.disposed || this.data.outfit?.revision !== outfit.revision) return;
        const latest = sameRevision(current.latest, outfit);
        const image = sameRevision(current.image, outfit);
        const fileId = image?.outputFileId || (outfit.revision === '0' ? outfit.sourceOutputFileId : '') || '';
        const changeHero = this.data.checkingCurrent || fileId !== this.data.heroFileId;
        this.setData({
            checkingCurrent: false, evaluation: sameRevision(current.evaluation, outfit), ...latestState(latest),
            ...(changeHero ? { heroFileId: fileId, heroImage: '', imageError: '' } : {})
        });
        if (changeHero && fileId) await this.loadHero(fileId);
    },
    async loadHero(fileId: string) {
        try {
            const image = await fileUrl(fileId);
            if (!this.disposed && stillOwner(this.account) && this.data.heroFileId === fileId) this.setData({ heroImage: image, imageError: '' });
        } catch (error) {
            if (!this.disposed && stillOwner(this.account) && this.data.heroFileId === fileId) this.setData({ heroImage: '', imageError: errorMessage(error) });
        }
    },
    heroFailed(e: Event) {
        if (e.currentTarget.dataset.fileId === this.data.heroFileId && e.currentTarget.dataset.src === this.data.heroImage) {
            this.setData({ heroImage: '', imageError: '上身效果图加载失败' });
        }
    },
    async retryHero() {
        await action(this, async () => {
            this.setData({ imageError: '' });
            if (this.data.heroFileId) await this.loadHero(this.data.heroFileId);
            else await this.readCurrent();
        });
    },
    toggleAdvice() { this.setData({ showAdvice: !this.data.showAdvice }); },
    async toggleHistory() {
        if (this.data.busy) return;
        if (this.data.showHistory) {
            this.setData(closedHistory);
        } else {
            this.setData({ showHistory: true });
            await action(this, () => this.readHistory(true));
        }
        this.schedulePoll();
    },
    async readHistory(refresh = false) {
        const outfit = this.data.outfit;
        if (!outfit || !this.data.showHistory) return;
        const list = this.lists.jobs;
        await list.load(async (page, size) => {
            const result = await api.outfitJobs(outfit.id, page, size);
            return { ...result, items: result.items.map(job => ({ ...job, id: job.taskId })) };
        }, refresh);
        assertAccount(this.account);
        if (this.disposed) return;
        this.displayHistory();
        if (outfit.revision !== '0' && outfit.sourceOutputFileId && !this.data.sourceHistoryImage) {
            const sourceHistoryImage = await fileUrl(outfit.sourceOutputFileId);
            this.setData({ sourceHistoryImage });
        }
        if (refresh && this.data.selectedJob) {
            const selected = list.items.find(job => job.taskId === this.data.selectedJob?.taskId);
            if (selected) await this.showJob(selected);
        }
    },
    displayHistory() {
        const list = this.lists.jobs;
        this.setData({ jobs: list.items.map(job => ({ ...job, label: statusLabel[job.status] || job.status })), jobMore: list.hasMore });
    },
    moreJobs() { return action(this, () => this.readHistory()); },
    async selectJob(e: Event) {
        if (this.data.busy || !this.data.showHistory) return;
        if (this.data.selectedJob?.taskId === id(e)) {
            this.setData({ selectedJob: null, jobImage: '', retryFull: false, retryImage: false });
        } else {
            await action(this, async () => {
                const job = await request<OutfitJob>(`/outfit-ai-jobs/${id(e)}`);
                await this.showJob(job);
            });
        }
        this.schedulePoll();
    },
    async showJob(job: OutfitJob) {
        if (this.disposed || job.outfitId !== this.data.outfitId) return;
        const old = this.data.selectedJob;
        const sameImage = old?.outputFileId === job.outputFileId && this.data.jobImage;
        this.setData({
            selectedJob: job, jobImage: sameImage || '',
            retryFull: job.actions.includes('RETRY_FULL'), retryImage: job.actions.includes('RETRY_IMAGE')
        });
        if (!sameImage && job.outputFileId) {
            const url = await fileUrl(job.outputFileId);
            if (!this.disposed && stillOwner(this.account) && this.data.selectedJob?.taskId === job.taskId) this.setData({ jobImage: url });
        }
    },
    schedulePoll() {
        clearTimeout(this.timer);
        if (this.visible && !this.data.editing && (this.data.processing || isActive(this.data.selectedJob?.status))) {
            this.timer = setTimeout(() => void this.poll(), 3000);
        }
    },
    async poll() {
        if (!this.visible || this.data.editing) return;
        await action(this, async () => {
            await this.readCurrent();
            if (!this.data.showHistory) return;
            const list = this.lists.jobs;
            const active = list.items.filter(job => isActive(job.status));
            const selected = this.data.selectedJob;
            if (selected && isActive(selected.status) && !active.some(job => job.taskId === selected.taskId)) active.push({ ...selected, id: selected.taskId });
            for (const job of active) {
                const latest = this.data.latestJob;
                const update = latest?.taskId === job.taskId ? latest : await request<OutfitJob>(`/outfit-ai-jobs/${job.taskId}`);
                assertAccount(this.account);
                if (this.disposed) return;
                const row = list.items.find(item => item.id === job.taskId);
                if (row) Object.assign(row, update);
                if (selected?.taskId === job.taskId) await this.showJob(update);
            }
            this.displayHistory();
        });
        this.schedulePoll();
    },
    async previewItem(e: Event) {
        const outfit = this.data.outfit;
        const selected = outfit?.items.find(item => item.dressId === id(e));
        const fileId = selected?.imageFileIds[0];
        if (!outfit || !fileId || this.data.editing || !this.visible) return;
        const visibility = this.visibilityVersion;
        await action(this, async () => {
            const images = await this.itemImageUrls(outfit, 'DISPLAY');
            assertAccount(this.account);
            if (this.disposed || visibility !== this.visibilityVersion || this.data.outfit?.revision !== outfit.revision) return;
            const current = images.get(fileId);
            if (!current) { toast('单品大图加载失败，请重试'); return; }
            const urls = outfit.items.map(item => images.get(item.imageFileIds[0])).filter((url): url is string => !!url);
            wx.previewImage({ current, urls, fail: () => toast('单品大图打开失败，请重试') });
        });
    },
    previewHero() { if (this.data.heroImage) wx.previewImage({ urls: [this.data.heroImage] }); },
    previewSource() { if (this.data.sourceHistoryImage) wx.previewImage({ urls: [this.data.sourceHistoryImage] }); },
    preview() { if (this.data.jobImage) wx.previewImage({ urls: [this.data.jobImage] }); },
    async saveImage(e: Event) {
        const target = e.currentTarget.dataset.target;
        const url = target === 'hero' ? this.data.heroImage : target === 'source' ? this.data.sourceHistoryImage : this.data.jobImage;
        if (url) await action(this, () => saveImage(url));
    }
});
