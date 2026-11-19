import { request } from '../../lib/request';
import { action, owner, stillOwner, value, id, type Event } from '../../features/page';
import { toast } from '../../lib/ui';
import { api } from '../../lib/api';
import { registerHistoryReceiver, releaseHistoryReceiver, type HistoryOpener } from '../../features/measurement-history';
import { measurementGroups, type Profile, type MeasurementKey } from '../../types/api';
import { measurementGuide, type MeasurementGuide } from '../../features/measurement-guide';

const historyVisits = new WeakMap<object, number>();
const pendingGuides = new WeakMap<object, MeasurementGuide>();
Page({
    data: {
        profile: null as Profile | null, groups: [] as {
            title: string;
            open: boolean;
            fields: {
                key: MeasurementKey;
                label: string;
                value: string;
                unit: string;
            }[];
        }[], error: '', busy: false, openingHistory: false, historyWriting: false,
        guide: null as MeasurementGuide | null, guideVisible: false
    },
    onLoad() {
        return this.load();
    },
    onShow() {
        if (this.data.profile && !stillOwner(this.data.profile.id)) {
            wx.reLaunch({ url: '/pages/home/index' });
        }
    },
    onHide() {
        this.closeGuide();
    },
    onUnload() {
        const visitId = historyVisits.get(this);
        if (visitId !== undefined) releaseHistoryReceiver(visitId);
        historyVisits.delete(this);
        pendingGuides.delete(this);
    },
    async onPullDownRefresh() {
        try {
            await this.load();
        } finally {
            wx.stopPullDownRefresh();
        }
    },
    async load() {
        if (this.data.historyWriting) return;
        await action(this, async () => {
            const accountId = await owner();
            if (!accountId || !stillOwner(accountId)) return;
            const profile = await api.profile();
            if (profile.id !== accountId || !stillOwner(accountId)) return;
            this.applyProfile(profile);
        });
    },
    applyProfile(profile: Profile) {
        const openGroups = new Map(this.data.groups.map(group => [group.title, group.open]));
        this.setData({
            profile,
            groups: measurementGroups.map(group => ({
                title: group.title,
                open: openGroups.get(group.title) ?? (group.title === '基础与头颈'),
                fields: group.fields.map(([key, label]) => ({
                    key, label, value: profile.currentMeasurement?.[key]?.toString() ?? '', unit: key === 'weight' ? 'kg' : 'cm'
                }))
            }))
        });
    },
    openHistory() {
        const profile = this.data.profile;
        if (this.data.busy || this.data.openingHistory || this.data.historyWriting || !profile || !stillOwner(profile.id)) return;
        const visitId = registerHistoryReceiver(change => {
            const current = this.data.profile;
            if (historyVisits.get(this) !== visitId || current?.id !== profile.id ||
                change.accountId !== profile.id || !stillOwner(profile.id)) return;
            if (change.kind === 'pending') {
                this.setData({ historyWriting: change.pending });
            } else if (change.kind === 'current') {
                if (change.profile.id === current.id) this.applyProfile(change.profile);
            } else if (current.version === change.previousVersion) {
                // Do not refresh the opener from a later read or touch any draft fields.
                this.setData({ profile: { ...current, version: change.version } });
            }
        });
        const opener: HistoryOpener = {
            visitId,
            accountId: profile.id,
            dirty: this.data.groups.some(group => group.fields.some(field =>
                field.value !== (profile.currentMeasurement?.[field.key]?.toString() ?? '')
            ))
        };
        historyVisits.set(this, visitId);
        this.closeGuide();
        this.setData({ openingHistory: true });
        wx.navigateTo({
            url: '/pages/measurement-history/index',
            success: ({ eventChannel }) => eventChannel.emit('measurementHistoryOpener', opener),
            fail: () => {
                releaseHistoryReceiver(visitId);
                historyVisits.delete(this);
                toast('无法打开尺寸历史，请重试');
            },
            complete: () => this.setData({ openingHistory: false })
        });
    },
    toggle(e: Event) {
        this.setData({
            groups: this.data.groups.map(g => g.title === id(e) ? {
                ...g, open: !g.open
            } : g)
        });
    }, field(e: Event) {
        if (this.data.historyWriting) return;
        this.setData({
            groups: this.data.groups.map(g => ({
                ...g, fields: g.fields.map(f => f.key === id(e) ? {
                    ...f, value: value(e)
                } : f)
            }))
        });
    },
    openGuide(e: Event) {
        const guide = measurementGuide(id(e), this.data.profile?.gender ?? null);
        if (!guide) return;
        pendingGuides.set(this, guide);
        wx.hideKeyboard({
            // Wait for the native call even when no keyboard was open.
            complete: () => {
                if (pendingGuides.get(this) !== guide) return;
                pendingGuides.delete(this);
                this.setData({ guide, guideVisible: true });
            }
        });
    },
    closeGuide() {
        pendingGuides.delete(this);
        if (this.data.guideVisible) this.setData({ guideVisible: false });
    },
    guideVisibilityChanged(e: Event) {
        if (e.detail.visible === false) this.closeGuide();
    },
    async save(e: Event) {
        if (this.data.busy || this.data.openingHistory || this.data.historyWriting) return;
        let saved = false;
        await action(this, async () => {
            const p = this.data.profile;
            if (!p || !stillOwner(p.id)) return;
            const fields = Object.fromEntries(this.data.groups.flatMap(g => g.fields.map(f => [
                f.key, f.value.trim() === '' ? null : Number(f.value)
            ])));
            if (Object.values(fields).some(v => v !== null && (!Number.isFinite(v) || v <= 0)))
                throw new Error('尺寸请填写大于零的数字，未测量可留空');
            const fresh = e.currentTarget.dataset.mode === 'new';
            await request(fresh ? '/profile/measurements' : '/profile/current-measurement', {
                method: fresh ? 'POST' : 'PATCH', body: {
                    ...fields, version: p.version, gender: p.gender
                }
            });
            if (!stillOwner(p.id)) return;
            saved = true;
            toast('尺寸已保存');
        });
        if (saved) await this.load();
    }
});
