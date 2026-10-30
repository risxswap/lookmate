import { request } from '../../lib/request';
import { requireAccount, getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, toast, query, errorMessage } from '../../lib/ui';
import { api } from '../../lib/api';
import { PagedList } from '../../features/account-list';
import { measurementGroups, measurementValues, type Profile, type Measurement, type MeasurementKey } from '../../types/api';
const history = new PagedList<Measurement>();
Page({
    data: {
        profile: null as Profile | null, groups: [] as {
            title: string;
            open: boolean;
            fields: {
                key: string;
                label: string;
                hint: string;
                value: string;
                unit: string;
            }[];
        }[], items: [] as Measurement[], total: 0, hasMore: false, error: '', busy: false
    },
    onLoad() {
        void this.load();
    }, async onPullDownRefresh() {
        await this.load();
        wx.stopPullDownRefresh();
    }, onReachBottom() {
        void this.more();
    },
    async load() {
        await action(this, async () => {
            if (!await owner())
                return;
            const p = await api.profile();
            this.setData({
                profile: p, groups: measurementGroups.map(g => ({
                    title: g.title, open: g.title === '基础与头颈', fields: g.fields.map(([key, label, hint]) => ({
                        key, label, hint, value: p.currentMeasurement?.[key]?.toString() || '', unit: key === 'weight' ? 'kg' : 'cm'
                    }))
                }))
            });
            await history.load(api.measurements, true);
            this.sync();
        });
    },
    sync() {
        this.setData({
            items: history.items, total: history.total, hasMore: history.hasMore, error: history.error
        });
    }, async more() {
        await history.load(api.measurements);
        this.sync();
    },
    toggle(e: Event) {
        this.setData({
            groups: this.data.groups.map(g => g.title === id(e) ? {
                ...g, open: !g.open
            } : g)
        });
    }, field(e: Event) {
        this.setData({
            groups: this.data.groups.map(g => ({
                ...g, fields: g.fields.map(f => f.key === id(e) ? {
                    ...f, value: value(e)
                } : f)
            }))
        });
    },
    async save(e: Event) {
        await action(this, async () => {
            const p = this.data.profile;
            if (!p)
                return;
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
            toast('尺寸已保存');
        });
        if (!this.data.error)
            await this.load();
    },
    async use(e: Event) {
        await action(this, async () => {
            await request('/profile/current-measurement', {
                method: 'PUT', body: {
                    version: this.data.profile?.version, measurementId: id(e) || null
                }
            });
        });
        if (!this.data.error)
            await this.load();
    },
    async remove(e: Event) {
        if (!await confirm('删除这条尺寸记录？'))
            return;
        await action(this, async () => {
            await request(`/profile/measurements/${id(e)}`, {
                method: 'DELETE', body: {
                    version: this.data.profile?.version
                }
            });
        });
        if (!this.data.error)
            await this.load();
    }
});
