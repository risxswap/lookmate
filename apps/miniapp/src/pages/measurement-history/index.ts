import { PagedList } from '../../features/account-list';
import { takeHistoryReceiver, type HistoryChange, type HistoryOpener } from '../../features/measurement-history';
import { action, id, owner, stillOwner, type Event } from '../../features/page';
import { api } from '../../lib/api';
import { request } from '../../lib/request';
import { confirm, errorMessage, toast } from '../../lib/ui';
import { measurementGroups, type Measurement, type Profile } from '../../types/api';

function filledFields(record: Measurement) {
    return measurementGroups.flatMap(group => group.fields.flatMap(([key, label]) => {
        const value = record[key];
        return value == null ? [] : [{ key, label, value, unit: key === 'weight' ? 'kg' : 'cm' }];
    }));
}

function summaryFields(fields: ReturnType<typeof filledFields>) {
    const priority = ({ key }: (typeof fields)[number]) => key === 'height' || key === 'weight' || key === 'waist';
    return [...fields.filter(priority), ...fields.filter(field => !priority(field))].slice(0, 3);
}

function details(record: Measurement) {
    return measurementGroups.map(group => ({
        title: group.title,
        fields: group.fields.map(([key, label]) => ({
            key, label, text: record[key] == null ? '未填' : `${record[key]} ${key === 'weight' ? 'kg' : 'cm'}`,
            filled: record[key] != null
        }))
    }));
}

function summarize(record: Measurement) {
    const fields = summaryFields(filledFields(record));
    return {
        id: record.id,
        date: dateText(record.createdAt),
        summary: fields.map(({ label, value, unit }) => `${label} ${value} ${unit}`).join(' · ') || '未填写尺寸'
    };
}

function dateText(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function chooseAction(label: string): Promise<boolean> {
    return new Promise(resolve => wx.showActionSheet({
        itemList: [label],
        success: result => resolve(result.tapIndex === 0),
        fail: () => resolve(false)
    }));
}

// DELETE uses an exact version check under the user lock and increments version once.
// Work with decimal strings so even versions past Number.MAX_SAFE_INTEGER stay exact.
function versionAfterDelete(version: string): string {
    const digits = version.split('');
    for (let i = digits.length - 1; i >= 0; i--) {
        if (digits[i] !== '9') {
            digits[i] = String(Number(digits[i]) + 1);
            return digits.join('');
        }
        digits[i] = '0';
    }
    return `1${digits.join('')}`;
}

interface Visit {
    pager: PagedList<Measurement>;
    channel: WechatMiniprogram.EventChannel | WechatMiniprogram.EmptyEventChannel;
    opener?: HistoryOpener;
    receive?: (change: HistoryChange) => void;
    receiveOpener: (opener: HistoryOpener) => void;
    retryRefresh: boolean;
}

const visits = new WeakMap<object, Visit>();

Page({
    data: {
        profile: null as Profile | null,
        currentFields: [] as ReturnType<typeof filledFields>,
        currentCount: 0,
        items: [] as ReturnType<typeof summarize>[],
        total: 0, loaded: false, hasMore: false,
        detailVisible: false,
        detail: null as { id: string; date: string; groups: ReturnType<typeof details> } | null,
        loadingList: false, listError: '', error: '', busy: false
    },
    onLoad() {
        const visit: Visit = {
            pager: new PagedList<Measurement>(), channel: this.getOpenerEventChannel(), retryRefresh: true,
            receiveOpener: opener => {
                if (visits.get(this) !== visit) return;
                visit.opener = opener;
                visit.receive = takeHistoryReceiver(opener.visitId);
                this.checkAccount(opener.accountId);
            }
        };
        visits.set(this, visit);
        visit.channel?.once?.('measurementHistoryOpener', visit.receiveOpener);
        return this.refresh();
    },
    onShow() {
        const accountId = visits.get(this)?.opener?.accountId ?? this.data.profile?.id;
        if (accountId) this.checkAccount(accountId);
    },
    onUnload() {
        const visit = visits.get(this);
        visits.delete(this);
        visit?.channel?.off?.('measurementHistoryOpener', visit.receiveOpener);
        visit?.pager.invalidate();
    },
    async onPullDownRefresh() {
        try {
            await this.refresh();
        } finally {
            wx.stopPullDownRefresh();
        }
    },
    onReachBottom() {
        if (!this.data.listError) void this.more();
    },
    checkAccount(accountId: string): boolean {
        const opener = visits.get(this)?.opener;
        if (stillOwner(accountId) && (!opener || opener.accountId === accountId)) return true;
        wx.reLaunch({ url: '/pages/home/index' });
        return false;
    },
    async refresh() {
        const visit = visits.get(this);
        await action(this, async () => {
            const accountId = await owner();
            if (!accountId || !visit || visits.get(this) !== visit || !this.checkAccount(accountId)) return;
            const profile = await api.profile();
            if (visits.get(this) !== visit || profile.id !== accountId || !this.checkAccount(accountId)) return;
            this.setProfile(profile);
            await this.loadPage(accountId, true);
        });
    },
    async more() {
        const accountId = this.data.profile?.id;
        if (!accountId || this.data.listError || !this.data.hasMore) return;
        await action(this, () => this.loadPage(accountId, false));
    },
    async retryList() {
        const accountId = this.data.profile?.id;
        const visit = visits.get(this);
        if (!accountId || !visit) return;
        await action(this, () => this.loadPage(accountId, visit.retryRefresh));
    },
    async loadPage(accountId: string, refresh: boolean) {
        const visit = visits.get(this);
        if (!visit || !this.checkAccount(accountId)) return;
        visit.retryRefresh = refresh;
        this.setData({ loadingList: true, listError: '' });
        try {
            await visit.pager.load(api.measurements, refresh);
            if (visits.get(this) === visit && this.checkAccount(accountId)) this.syncList();
        } catch (error) {
            if (visits.get(this) === visit && this.checkAccount(accountId)) this.setData({ listError: errorMessage(error) });
        } finally {
            if (visits.get(this) === visit) this.setData({ loadingList: false });
        }
    },
    syncList() {
        const pager = visits.get(this)?.pager;
        if (!pager) return;
        const detailVisible = this.data.detailVisible && pager.items.some(item => item.id === this.data.detail?.id);
        this.setData({
            items: pager.items.map(summarize),
            total: pager.total, loaded: pager.page > 0, hasMore: pager.hasMore,
            detailVisible
        });
    },
    openDetail(e: Event) {
        const record = visits.get(this)?.pager.items.find(item => item.id === id(e));
        if (!record) return;
        this.setData({
            detail: { id: record.id, date: dateText(record.createdAt), groups: details(record) },
            detailVisible: true
        });
    },
    closeDetail() {
        this.setData({ detailVisible: false });
    },
    detailVisibilityChanged(e: Event) {
        if (e.detail.visible === false) this.closeDetail();
    },
    showsDetail(recordId: string): boolean {
        return this.data.detailVisible && this.data.detail?.id === recordId;
    },
    setProfile(profile: Profile) {
        const fields = profile.currentMeasurement ? filledFields(profile.currentMeasurement) : [];
        this.setData({ profile, currentFields: summaryFields(fields), currentCount: fields.length });
    },
    writableProfile(visit?: Visit): Profile | null {
        const profile = this.data.profile;
        if (!profile || !visit || (visit.channel?.once && !visit.receive) || !this.checkAccount(profile.id)) return null;
        return profile;
    },
    notify(visit: Visit, change: HistoryChange) {
        if (visit.opener?.accountId === change.accountId && stillOwner(change.accountId)) visit.receive?.(change);
    },
    async currentMenu() {
        await action(this, async () => {
            if (!this.data.profile?.currentMeasurement || !await chooseAction('暂不使用尺寸')) return;
            await this.setCurrent(null);
        });
    },
    async useSelected(e: Event) {
        const recordId = id(e);
        if (!this.showsDetail(recordId)) return;
        await action(this, () => this.setCurrent(recordId));
    },
    async setCurrent(measurementId: string | null) {
        const visit = visits.get(this);
        const profile = this.writableProfile(visit);
        if (!visit || !profile) return;
        if (measurementId ? !visit.pager.items.some(item => item.id === measurementId) : !profile.currentMeasurement) return;
        if (visit.opener?.dirty && !await confirm(measurementId
            ? '使用此记录会替换身体尺寸页未保存的输入。确定使用吗？'
            : '暂不使用尺寸会清空当前尺寸和未保存的输入，历史记录仍会保留。确定清空吗？')) return;
        if (visits.get(this) !== visit || !this.checkAccount(profile.id)) return;
        if (measurementId && !this.showsDetail(measurementId)) return;
        const accountId = profile.id;
        this.notify(visit, { kind: 'pending', accountId, pending: true });
        try {
            const fresh = await request<Profile>('/profile/current-measurement', {
                method: 'PUT', body: { version: profile.version, measurementId }
            });
            if (fresh.id !== accountId || !this.checkAccount(accountId)) return;
            if (visit.opener) visit.opener = { ...visit.opener, dirty: false };
            this.notify(visit, { kind: 'current', accountId, profile: fresh });
            if (visits.get(this) === visit) this.setProfile(fresh);
            toast(measurementId ? '已使用此记录' : '已清空当前尺寸');
        } finally {
            this.notify(visit, { kind: 'pending', accountId, pending: false });
        }
    },
    async detailMenu(e: Event) {
        const recordId = id(e);
        if (!this.showsDetail(recordId)) return;
        await action(this, async () => {
            if (!await chooseAction('删除记录') || !this.showsDetail(recordId)) return;
            const visit = visits.get(this);
            const profile = this.writableProfile(visit);
            if (!visit || !profile) return;
            const { pager } = visit;
            if (!await confirm('删除这条尺寸记录？不会影响当前尺寸。')) return;
            if (visits.get(this) !== visit || !this.checkAccount(profile.id)) return;
            if (!this.showsDetail(recordId)) return;
            const accountId = profile.id;
            this.notify(visit, { kind: 'pending', accountId, pending: true });
            try {
                await request<null>(`/profile/measurements/${recordId}`, {
                    method: 'DELETE', body: { version: profile.version }
                });
                if (!this.checkAccount(accountId)) return;
                const version = versionAfterDelete(profile.version);
                this.notify(visit, { kind: 'deleted', accountId, previousVersion: profile.version, version });
                toast('已删除尺寸记录');
                if (visits.get(this) !== visit) return;
                this.setData({ profile: { ...profile, version } });
                pager.items = pager.items.filter(item => item.id !== recordId);
                pager.total--;
                this.syncList();
            } finally {
                this.notify(visit, { kind: 'pending', accountId, pending: false });
            }
            // Page boundaries may have shifted. Start again at page 1, keeping the visible records if it fails.
            await this.loadPage(profile.id, true);
        });
    }
});
