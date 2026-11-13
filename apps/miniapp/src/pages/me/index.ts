import { request } from '../../lib/request';
import { requireAccount } from '../../lib/auth';
import { action, stillOwner, value, go, type Event } from '../../features/page';
import { toast } from '../../lib/ui';
import { fileUrl } from '../../lib/files';
import type { Account } from '../../types/api';

Page({
    data: {
        account: null as Account | null,
        avatar: '',
        error: '',
        busy: false,
        passwordOpen: false,
        currentPassword: '',
        newPassword: ''
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
            const avatar = account.avatarFileId ? await fileUrl(account.avatarFileId) : '';
            if (stillOwner(account.id)) this.setData({ account, avatar });
        });
    },
    avatarError() {
        this.setData({ avatar: '' });
    },
    password() {
        if (this.data.busy) return;
        this.setData({ passwordOpen: !this.data.passwordOpen });
    },
    field(e: Event) {
        this.setData({ [String(e.currentTarget.dataset.key)]: value(e) });
    },
    async savePassword() {
        await action(this, async () => {
            await request('/auth/password', {
                method: 'POST',
                body: {
                    currentPassword: this.data.currentPassword,
                    newPassword: this.data.newPassword
                }
            });
            this.setData({ passwordOpen: false, currentPassword: '', newPassword: '' });
            toast('密码已修改，请恢复登录');
        });
        if (!this.data.error) await this.load();
    }
});
