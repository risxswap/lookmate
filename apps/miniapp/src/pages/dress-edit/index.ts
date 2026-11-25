import { saveDress } from '../../features/dresses';
import { ApiError, request } from '../../lib/request';
import { action, owner, value, id, type Event } from '../../features/page';
import { confirm, toast, errorMessage } from '../../lib/ui';
import { api } from '../../lib/api';
import { chooseAndUpload, fileUrl, fileUrls } from '../../lib/files';
import { seasons, featureLabels, recognitionLabels, type Dress, type DressImage, type Category, type FeatureKey, type Recognition } from '../../types/api';
const details = {
    neckline: '领口', sleeve: '袖型', pocket: '口袋', button: '纽扣'
};

function seasonOptions(selected: string[]) {
    return seasons.map(season => ({
        ...season, label: season.label.replace('季', ''), checked: selected.includes(season.value)
    }));
}

function featureRows(image: DressImage) {
    return Object.entries(featureLabels).map(([key, label]) => {
        const feature = image.effectiveFeatures?.[key as FeatureKey];
        const text = Array.isArray(feature) ? feature.join('、')
            : feature && typeof feature === 'object'
                ? Object.entries(feature).map(([name, value]) => `${details[name as keyof typeof details] || name}：${value || '未知'}`).join('；')
                : feature || '';
        return {
            key, label, text: text || '未识别',
            manual: Object.prototype.hasOwnProperty.call(image.manualFeatures || {}, key)
        };
    });
}

Page({
    data: {
        dressId: '', dress: null as Dress | null, name: '', categoryId: '', categoryIndex: 0, categoryName: '请选择分类', categories: [] as Category[],
        fieldErrors: { photos: '', name: '', category: '' }, saving: false, loadFailed: false,
        color: '', notes: '', seasons: [] as string[], seasonOptions: seasonOptions([]), images: [] as {
            id?: string;
            fileId: string;
            url: string;
        }[], recognitionText: '', recognitionVisible: false, recognitionImageId: '', recognitionThumb: '', recognitionPhotoNumber: 0,
        recognitionEditing: false, recognitionEditError: '', recognitionRefreshNeeded: false, features: [] as ReturnType<typeof featureRows>,
        featureChoices: Object.entries(featureLabels).map(([key, label]) => ({key: key as FeatureKey, label})),
        featureIndex: 0, featureKey: 'viewType' as FeatureKey, featureValue: '', featureRevised: false, viewIndex: 0,
        detailValues: {} as Record<string, string | null>, detailFields: Object.entries(details).map(([key, label]) => ({
            key, label
        })), viewOptions: [
            'FRONT', 'BACK', 'SIDE', 'DETAIL', 'OTHER'
        ], busy: false, error: ''
    },
    onLoad(q: Record<string, string | undefined>) {
        wx.setNavigationBarTitle({ title: q.id ? '衣物详情' : '添加衣物' });
        this.setData({
            dressId: q.id || ''
        });
        return this.load();
    },
    async load() {
        await action(this, async () => {
            this.setData({ loadFailed: false });
            try {
                if (!await owner()) return;
                this.setData({ categories: await api.categories() });
                if (!this.data.dressId) return;
                const dress = await api.dress(this.data.dressId);
                const urls = await fileUrls(dress.images.map(image => image.fileId));
                this.showDress(dress, urls);
            } catch (error) {
                this.setData({ loadFailed: true });
                throw error;
            }
        });
    },
    showDress(d: Dress, urls: Record<string, string>) {
        const categoryIndex = this.data.categories.findIndex(category => category.id === d.categoryId);
        this.setData({
            dressId: d.id, dress: d, name: d.name, categoryId: d.categoryId,
            categoryIndex: Math.max(0, categoryIndex), categoryName: this.data.categories[categoryIndex]?.name || '请选择分类',
            color: d.color || '', notes: d.notes || '', seasons: d.seasons, seasonOptions: seasonOptions(d.seasons),
            fieldErrors: { photos: '', name: '', category: '' }, images: d.images.map(i => ({
                ...i, url: urls[i.fileId]
            })), recognitionText: d.recognition ? recognitionLabels[d.recognition.status] : ''
        });
    },
    field(e: Event) {
        if (this.data.busy) return;
        const key = String(e.currentTarget.dataset.key);
        const text = value(e);
        this.setData({
            [key]: text,
            ...(key === 'name' && text.trim() && this.data.fieldErrors.name
                ? { fieldErrors: { ...this.data.fieldErrors, name: '' } } : {})
        });
    }, category(e: Event) {
        if (this.data.busy) return;
        const categoryIndex = Number(value(e));
        const c = this.data.categories[categoryIndex];
        if (c)
            this.setData({
                categoryId: c.id, categoryName: c.name, categoryIndex,
                fieldErrors: { ...this.data.fieldErrors, category: '' }
            });
    }, season(e: Event) {
        if (this.data.busy) return;
        const selected = e.detail.value as string[];
        this.setData({ seasons: selected, seasonOptions: seasonOptions(selected) });
    },
    async add() {
        const remaining = 8 - this.data.images.length;
        if (remaining <= 0) return;
        await action(this, async () => {
            let ids: string[];
            try {
                ids = await chooseAndUpload(remaining);
            } catch (error) {
                if (error && typeof error === 'object' && 'errMsg' in error &&
                    /^chooseMedia:fail cancel\b/i.test(String(error.errMsg))) return;
                throw error;
            }
            if (!ids.length) return;
            const urls = await fileUrls(ids);
            this.setData({
                fieldErrors: { ...this.data.fieldErrors, photos: '' },
                images: [
                    ...this.data.images, ...ids.map(fileId => ({
                        fileId, url: urls[fileId]
                    }))
                ]
            });
        });
    }, async preview(e: Event) {
        const image = this.data.images.find(i => i.fileId === id(e));
        if (!image)
            return;
        await action(this, async () => {
            const url = await fileUrl(image.fileId);
            wx.previewImage({ urls: [url] });
        });
    },
    async photoMenu(e: Event) {
        const fileId = id(e);
        const image = this.data.images.find(item => item.fileId === fileId);
        if (!image || this.data.busy)
            return;

        const actions: { label: string; run: () => void }[] = [];
        if (this.data.images[0] !== image)
            actions.push({ label: '设为封面', run: () => this.setCover(fileId) });

        const recognized = this.data.dress?.images.find(item => item.id === image.id && item.recognitionId);
        if (recognized)
            actions.push({ label: '查看识别', run: () => this.openRecognition(recognized, image.url, this.data.images.indexOf(image) + 1) });
        actions.push({ label: '移除照片', run: () => {
            this.setData({ images: this.data.images.filter(item => item.fileId !== fileId) });
        } });

        const index = await new Promise<number | null>(resolve => wx.showActionSheet({
            itemList: actions.map(item => item.label),
            success: result => resolve(result.tapIndex),
            fail: () => resolve(null)
        }));
        if (index !== null && !this.data.busy && this.data.images.includes(image))
            actions[index]?.run();
    },
    setCover(fileId: string) {
        const image = this.data.images.find(item => item.fileId === fileId);
        if (!image)
            return;
        this.setData({ images: [image, ...this.data.images.filter(item => item !== image)] }, () => {
            wx.createSelectorQuery().select('.photo-scroll').node(result => {
                const scroll = result?.node as WechatMiniprogram.ScrollViewContext | undefined;
                scroll?.scrollTo({ left: 0, animated: false });
            }).exec();
        });
    },
    async save() {
        if (this.data.loadFailed) return;
        await action(this, async () => {
            const fieldErrors = {
                photos: this.data.images.length ? '' : '请至少添加一张衣物照片',
                name: this.data.name.trim() ? '' : '请填写衣物名称',
                category: this.data.categoryId ? '' : '请选择衣物分类'
            };
            this.setData({ fieldErrors });
            const first = Object.entries(fieldErrors).find(([, message]) => message);
            if (first) {
                wx.nextTick(() => wx.pageScrollTo({ selector: '#dress-' + first[0], offsetTop: -12, duration: 180 }));
                return;
            }
            if (this.data.dressId && !this.data.dress) throw new Error('请先重新加载衣物详情');
            this.setData({ saving: true });
            try {
                const creating = !this.data.dressId;
                const d = await saveDress(this.data, this.data.dress);
                const urls = Object.fromEntries(this.data.images.map(image => [image.fileId, image.url]));
                this.showDress(d, urls);
                if (creating) wx.setNavigationBarTitle({ title: '衣物详情' });
                toast('衣物已保存');
                const missingUrls = d.images.filter(image => !urls[image.fileId]).map(image => image.fileId);
                if (missingUrls.length) this.showDress(d, { ...urls, ...await fileUrls(missingUrls) });
            } finally {
                this.setData({ saving: false });
            }
        });
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
            const recognition = await request<Recognition>(`/dresses/${this.data.dressId}/recognition-retry`, {
                method: 'POST', body: {
                    recognitionId: r.id, confirmUnknown: r.status === 'UNKNOWN'
                }
            });
            this.setData({
                'dress.recognition': recognition,
                recognitionText: recognitionLabels[recognition.status] || ''
            });
        });
    },
    async refreshRecognition() {
        await action(this, async () => {
            try {
                const dress = await api.dress(this.data.dressId);
                const status = dress.recognition?.status;
                this.setData({ dress, recognitionText: status ? recognitionLabels[status] || '' : '' });
                if (this.data.recognitionVisible) {
                    const image = dress.images.find(i => i.id === this.data.recognitionImageId);
                    if (image) {
                        this.setData({ features: featureRows(image), recognitionEditing: false, recognitionEditError: '', recognitionRefreshNeeded: false });
                    } else {
                        this.setData({ recognitionVisible: false });
                        toast('这张照片已不存在');
                    }
                } else if (status === 'SUCCEEDED') {
                    toast('识别完成');
                }
            } catch (error) {
                if (!this.data.recognitionVisible)
                    throw error;
                this.setData({ recognitionEditError: errorMessage(error) });
            }
        });
    },
    openRecognition(image: DressImage, thumb: string, photoNumber: number) {
        this.setData({
            recognitionVisible: true, recognitionImageId: image.id, recognitionThumb: thumb,
            recognitionPhotoNumber: photoNumber, recognitionEditing: false, recognitionEditError: '', recognitionRefreshNeeded: false,
            features: featureRows(image)
        });
    },
    closeRecognition() {
        if (!this.data.busy)
            this.setData({ recognitionVisible: false });
    },
    beginRecognitionEdit() {
        this.selectFeature(0);
        this.setData({ recognitionEditing: true });
    },
    cancelRecognitionEdit() {
        if (!this.data.busy)
            this.setData({ recognitionEditing: false });
    },
    changeFeature(e: Event) {
        this.selectFeature(Number(value(e)));
    },
    selectFeature(index: number) {
        const key = this.data.featureChoices[index]?.key;
        const image = this.data.dress?.images.find(i => i.id === this.data.recognitionImageId);
        if (!key || !image)
            return;
        const feature = image.effectiveFeatures?.[key];
        this.setData({
            featureIndex: index, featureKey: key,
            featureValue: Array.isArray(feature) ? feature.join('、') : typeof feature === 'string' ? feature : '',
            detailValues: feature && typeof feature === 'object' && !Array.isArray(feature) ? { ...feature } : {},
            featureRevised: Object.prototype.hasOwnProperty.call(image.manualFeatures || {}, key),
            viewIndex: key === 'viewType' && typeof feature === 'string' ? Math.max(0, this.data.viewOptions.indexOf(feature)) : 0
        });
    }, detailField(e: Event) {
        this.setData({
            ['detailValues.' + id(e)]: value(e)
        });
    }, view(e: Event) {
        const viewIndex = Number(value(e));
        this.setData({ viewIndex, featureValue: this.data.viewOptions[viewIndex] });
    },
    async saveFeature(e: Event) {
        await action(this, async () => {
            const image = this.data.dress?.images.find(i => i.id === this.data.recognitionImageId);
            if (!image || !this.data.recognitionEditing || this.data.recognitionRefreshNeeded)
                return;
            const key = this.data.featureKey;
            const reset = e.currentTarget.dataset.reset;
            const text = this.data.featureValue.trim();
            const feature = key === 'details'
                ? Object.fromEntries(Object.keys(details).map(name => [name, this.data.detailValues[name] || null]))
                : key === 'colors' || key === 'styleTags' ? text.split(/[、,，]/).filter(Boolean) : text || null;
            this.setData({ recognitionEditError: '' });
            try {
                const dress = await request<Dress>(`/dresses/${this.data.dressId}/images/${image.id}`, {
                    method: 'PATCH', body: {
                        version: image.version,
                        ...(reset ? { resetFeatureKeys: [key] } : { manualFeatures: { [key]: feature } })
                    }
                });
                const updatedImage = dress.images.find(item => item.id === image.id);
                this.setData({
                    dress, recognitionText: dress.recognition ? recognitionLabels[dress.recognition.status] || '' : '',
                    features: updatedImage ? featureRows(updatedImage) : [], recognitionEditing: false
                });
                toast('识别内容已更新');
            } catch (error) {
                this.setData({
                    recognitionEditError: errorMessage(error),
                    recognitionRefreshNeeded: error instanceof ApiError && error.detail.code === 'VERSION_CONFLICT'
                });
            }
        });
    }
});
