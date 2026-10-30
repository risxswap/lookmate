import { request } from '../../lib/request';
import { requireAccount, getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, toast, query, errorMessage } from '../../lib/ui';
import { api } from '../../lib/api';
import { chooseAndUpload, fileUrls } from '../../lib/files';
import { seasons, featureLabels, recognitionLabels, type Dress, type DressImage, type Category, type Features, type FeatureKey } from '../../types/api';
const details = {
    neckline: '领口', sleeve: '袖型', pocket: '口袋', button: '纽扣'
};
Page({
    data: {
        dressId: '', dress: null as Dress | null, name: '', categoryId: '', categoryName: '请选择分类', categories: [] as Category[], color: '', notes: '', seasons: [] as string[], seasonOptions: seasons.map(s => ({
            ...s, checked: false
        })), images: [] as {
            id?: string;
            fileId: string;
            url: string;
        }[], recognitionText: '', features: [] as {
            key: string;
            label: string;
            text: string;
            manual: boolean;
        }[], editingImage: '', featureKey: 'description', featureValue: '', detailValues: {} as Record<string, string | null>, detailFields: Object.entries(details).map(([key, label]) => ({
            key, label
        })), viewOptions: [
            'FRONT', 'BACK', 'SIDE', 'DETAIL', 'OTHER'
        ], busy: false, error: ''
    },
    onLoad(q: Record<string, string | undefined>) {
        this.setData({
            dressId: q.id || ''
        });
        void this.load();
    },
    async load() {
        await action(this, async () => {
            if (!await owner())
                return;
            const categories = await api.categories();
            this.setData({
                categories
            });
            if (!this.data.dressId)
                return;
            const d = await api.dress(this.data.dressId);
            const urls = await fileUrls(d.images.map(i => i.fileId));
            this.setData({
                dress: d, name: d.name, categoryId: d.categoryId, categoryName: categories.find(c => c.id === d.categoryId)?.name || '请选择', color: d.color || '', notes: d.notes || '', seasons: d.seasons, seasonOptions: seasons.map(s => ({
                    ...s, checked: d.seasons.includes(s.value)
                })), images: d.images.map(i => ({
                    ...i, url: urls[i.fileId]
                })), recognitionText: d.recognition ? recognitionLabels[d.recognition.status] : ''
            });
            this.selectFeatures(d.images[0]?.id || '');
        });
    },
    field(e: Event) {
        this.setData({
            [String(e.currentTarget.dataset.key)]: value(e)
        });
    }, category(e: Event) {
        const c = this.data.categories[Number(value(e))];
        if (c)
            this.setData({
                categoryId: c.id, categoryName: c.name
            });
    }, season(e: Event) {
        this.setData({
            seasons: e.detail.value
        });
    },
    async add() {
        await action(this, async () => {
            const ids = await chooseAndUpload(Math.max(1, 8 - this.data.images.length));
            const urls = await fileUrls(ids);
            this.setData({
                images: [
                    ...this.data.images, ...ids.map(fileId => ({
                        fileId, url: urls[fileId]
                    }))
                ]
            });
        });
    }, removeImage(e: Event) {
        this.setData({
            images: this.data.images.filter(i => i.fileId !== id(e))
        });
    }, cover(e: Event) {
        const im = this.data.images.find(i => i.fileId === id(e));
        if (im)
            this.setData({
                images: [
                    im, ...this.data.images.filter(i => i !== im)
                ]
            });
    },
    async save() {
        await action(this, async () => {
            if (!this.data.name.trim() || !this.data.categoryId || !this.data.images.length)
                throw new Error('请填写衣物名称、分类并添加至少一张照片');
            const d = await request<Dress>(this.data.dressId ? `/dresses/${this.data.dressId}` : '/dresses', {
                method: this.data.dressId ? 'PATCH' : 'POST', body: {
                    name: this.data.name.trim(), categoryId: this.data.categoryId, color: this.data.color || null, notes: this.data.notes || null, seasons: this.data.seasons, images: this.data.images.map(i => ({
                        fileId: i.fileId, ...(i.id ? {
                            imageId: i.id
                        } : {})
                    }))
                }
            });
            this.setData({
                dressId: d.id
            });
            toast('衣物已保存');
        });
        if (!this.data.error)
            await this.load();
    },
    async remove() {
        if (!await confirm('删除这件衣物？历史设计和已保存搭配不受影响。'))
            return;
        await action(this, async () => {
            await request(`/dresses/${this.data.dressId}`, {
                method: 'DELETE'
            });
            wx.navigateBack();
        });
    },
    async retry() {
        const r = this.data.dress?.recognition;
        if (!r)
            return;
        if (r.status === 'UNKNOWN' && !await confirm('上次识别结果未知，确认重新识别？'))
            return;
        await action(this, async () => {
            await request(`/dresses/${this.data.dressId}/recognition-retry`, {
                method: 'POST', body: {
                    recognitionId: r.id, confirmUnknown: r.status === 'UNKNOWN'
                }
            });
        });
        if (!this.data.error)
            await this.load();
    },
    selectFeatures(imageId: string) {
        const im = this.data.dress?.images.find(i => i.id === imageId);
        this.setData({
            editingImage: imageId, features: Object.entries(featureLabels).map(([key, label]) => {
                const v = im?.effectiveFeatures?.[key as FeatureKey];
                return {
                    key, label, text: Array.isArray(v) ? v.join('、') : v && typeof v === 'object' ? Object.entries(v).map(([k, t]) => `${details[k as keyof typeof details] || k}：${t || '未知'}`).join('；') : String(v || '未识别'), manual: Object.prototype.hasOwnProperty.call(im?.manualFeatures || {}, key)
                };
            })
        });
    }, imageFeatures(e: Event) {
        this.selectFeatures(id(e));
    },
    editFeature(e: Event) {
        const key = id(e) as FeatureKey;
        const im = this.data.dress?.images.find(i => i.id === this.data.editingImage);
        const v = im?.effectiveFeatures?.[key];
        this.setData({
            featureKey: key, featureValue: Array.isArray(v) ? v.join('、') : typeof v === 'string' ? v : '', detailValues: v && typeof v === 'object' && !Array.isArray(v) ? v : {}
        });
    }, detailField(e: Event) {
        this.setData({
            ['detailValues.' + id(e)]: value(e)
        });
    }, view(e: Event) {
        this.setData({
            featureValue: this.data.viewOptions[Number(value(e))]
        });
    },
    async saveFeature(e: Event) {
        await action(this, async () => {
            const im = this.data.dress?.images.find(i => i.id === this.data.editingImage);
            if (!im)
                return;
            const k = this.data.featureKey;
            const reset = e.currentTarget.dataset.reset;
            const text = this.data.featureValue.trim();
            const v = k === 'details' ? Object.fromEntries(Object.keys(details).map(k => [
                k, this.data.detailValues[k] || null
            ])) : [
                'colors', 'styleTags'
            ].includes(k) ? text.split(/[、,，]/).filter(Boolean) : text || null;
            await request(`/dresses/${this.data.dressId}/images/${im.id}`, {
                method: 'PATCH', body: {
                    version: im.version, ...(reset ? {
                        resetFeatureKeys: [
                            k
                        ]
                    } : {
                        manualFeatures: {
                            [k]: v
                        }
                    })
                }
            });
            toast('识别内容已更新');
        });
        if (!this.data.error)
            await this.load();
    }
});
