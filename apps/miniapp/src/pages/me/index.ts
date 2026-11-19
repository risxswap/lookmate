import { requireAccount } from '../../lib/auth';
import { action, stillOwner, go } from '../../features/page';
import { fileUrl } from '../../lib/files';
import type { Account } from '../../types/api';

Page({
    data: {
        account: null as Account | null,
        avatar: '',
        error: '',
        busy: false
    },
    onShow() {
        void this.load();
    },
    async onPullDownRefresh() {
        await this.load();
        wx.stopPullDownRefresh();
    },
    go,
    async load() {
        await action(this, async () => {
            const account = await requireAccount();
            if (!account) return;
            const avatar = account.avatarFileId ? await fileUrl(account.avatarFileId, 'THUMBNAIL') : '';
            if (stillOwner(account.id)) this.setData({ account, avatar });
        });
    },
    avatarError() {
        this.setData({ avatar: '' });
    }
});
