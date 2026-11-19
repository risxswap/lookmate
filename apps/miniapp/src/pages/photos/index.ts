import { request } from '../../lib/request';
import { getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, type Event } from '../../features/page';
import { confirm, toast } from '../../lib/ui';
import { chooseAndUpload, fileUrl } from '../../lib/files';
import type { Photo } from '../../types/api';
interface Slots {
    version: string;
    portrait: Photo | null;
    fullBody: Photo | null;
    angles: Record<string, Photo | null>;
    supplements: Photo[];
    supplementTotal: number;
    total: number;
}
const definitions = [
    {
        key: 'PORTRAIT', name: '正面头像照'
    }, {
        key: 'FULL_BODY', name: '正面全身照'
    }, {
        key: 'SIDE_FACE', name: '侧脸'
    }, {
        key: 'BACK_HEAD', name: '后脑'
    }, {
        key: 'SIDE_BODY', name: '侧面全身'
    }, {
        key: 'BACK_BODY', name: '背面全身'
    }
];
Page({
    data: {
        rows: [] as {
            key: string;
            name: string;
            photo: Photo | null;
            url: string;
        }[], version: '', error: '', busy: false, legacy: [] as Photo[], supplementTotal: 0, angleNames: [
            '侧脸', '后脑', '侧面全身', '背面全身'
        ]
    },
    onShow() {
        void this.load();
    }, async onPullDownRefresh() {
        await this.load();
        wx.stopPullDownRefresh();
    },
    async load() {
        await action(this, async () => {
            const account = await owner();
            if (!account)
                return;
            const slots = await request<Slots>('/photos/slots');
            const rows = await Promise.all(definitions.map(async d => {
                const photo = d.key === 'PORTRAIT' ? slots.portrait : d.key === 'FULL_BODY' ? slots.fullBody : slots.angles[d.key] || null;
                const url = photo ? await fileUrl(photo.fileId, 'THUMBNAIL').catch(() => '') : '';
                return { ...d, photo, url };
            }));
            if (stillOwner(account))
                this.setData({
                    version: slots.version, supplementTotal: slots.supplementTotal, rows,
                    legacy: slots.supplements.filter(p => !p.angle)
                });
        });
    },
    thumbnailError(e: Event) {
        const index = this.data.rows.findIndex(row => row.key === id(e) && row.url === e.currentTarget.dataset.url);
        if (index >= 0)
            this.setData({ [`rows[${index}].url`]: '' });
    },
    async photoMenu(e: Event) {
        const row = this.data.rows.find(item => item.key === id(e));
        const photoId = row?.photo?.id;
        const account = getAccount()?.id;
        const version = this.data.version;
        if (!row || !photoId || !account || this.data.busy)
            return;
        const selection = await new Promise<number | null>(resolve => wx.showActionSheet({
            itemList: ['更换照片', '删除照片'],
            success: result => resolve(result.tapIndex),
            fail: () => resolve(null)
        }));
        if (!stillOwner(account) || this.data.busy || this.data.version !== version)
            return;
        if (selection === 0)
            await this.uploadPhoto(row.key);
        if (selection === 1)
            await this.removePhoto(photoId);
    },
    async upload(e: Event) {
        const key = id(e);
        if (this.data.rows.some(row => row.key === key && !row.photo))
            await this.uploadPhoto(key);
    },
    async uploadPhoto(key: string) {
        const row = this.data.rows.find(r => r.key === key);
        if (!row)
            return;
        await action(this, async () => {
            const supplement = ![
                'PORTRAIT', 'FULL_BODY'
            ].includes(row.key);
            let replacePhotoId = row.photo?.id;
            if (supplement && !replacePhotoId && this.data.supplementTotal >= 4) {
                if (!this.data.legacy.length)
                    throw new Error('补充照片已满，请先移除不用的照片');
                const selection = await new Promise<number | null>(resolve => wx.showActionSheet({
                    itemList: this.data.legacy.map((_, i) => `替换旧版未分类照片 ${i + 1}`), success: r => resolve(r.tapIndex), fail: () => resolve(null)
                }));
                if (selection === null)
                    return;
                replacePhotoId = this.data.legacy[selection].id;
            }
            const files = await chooseAndUpload();
            if (!files[0])
                return;
            await request('/photos/slots', {
                method: 'POST', body: {
                    version: this.data.version, fileId: files[0], slot: supplement ? 'SUPPLEMENT' : row.key, ...(supplement ? {
                        angle: row.key, ...(replacePhotoId ? {
                            replacePhotoId
                        } : {})
                    } : {})
                }
            });
            toast('照片已保存');
        });
        if (!this.data.error)
            await this.load();
    },
    async remove(e: Event) {
        await this.removePhoto(id(e));
    },
    async removePhoto(photoId: string) {
        let removed = false;
        await action(this, async () => {
            const account = getAccount()?.id;
            if (!account || !await confirm('删除这张个人照片？历史设计仍保留原有图片。') || !stillOwner(account))
                return;
            await request(`/photos/${photoId}`, {
                method: 'DELETE', body: {
                    version: this.data.version
                }
            });
            removed = true;
        });
        if (removed)
            await this.load();
    },
    async assign(e: Event) {
        const angle = [
            'SIDE_FACE', 'BACK_HEAD', 'SIDE_BODY', 'BACK_BODY'
        ][Number(value(e))];
        await action(this, async () => {
            await request(`/photos/${id(e)}/angle`, {
                method: 'PATCH', body: {
                    version: this.data.version, angle
                }
            });
            toast('照片已归位');
        });
        if (!this.data.error)
            await this.load();
    }, async preview(e: Event) {
        const row = this.data.rows.find(row => row.key === id(e));
        if (!row?.photo) return;
        const fileId = row.photo.fileId;
        await action(this, async () => {
            const url = await fileUrl(fileId);
            wx.previewImage({ urls: [url] });
        });
    }
});
