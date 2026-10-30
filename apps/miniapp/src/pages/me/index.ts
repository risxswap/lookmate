import { request } from '../../lib/request';
import { requireAccount, getAccount } from '../../lib/auth';
import { action, owner, stillOwner, value, id, go, type Event } from '../../features/page';
import { confirm, toast, query, errorMessage } from '../../lib/ui';
import { fileUrl } from '../../lib/files';
import type { Account } from '../../types/api';
Page({
    data: {
        account: null as Account | null, avatar: '', error: '', busy: false, passwordOpen: false, currentPassword: '', newPassword: ''
    },
    onShow() {
        void this.load();
    }, async onPullDownRefresh() {
        await this.load();
        wx.stopPullDownRefresh();
    }, go,
    async load() {
        await action(this, async () => {
            const account = await requireAccount();
            if (!account)
                return;
            const avatar = account.avatarFileId ? await fileUrl(account.avatarFileId) : '';
            if (stillOwner(account.id))
                this.setData({
                    account, avatar
                });
        });
    },
    password() {
        this.setData({
            passwordOpen: !this.data.passwordOpen
        });
    }, field(e: Event) {
        this.setData({
            [String(e.currentTarget.dataset.key)]: value(e)
        });
    },
    async savePassword() {
        await action(this, async () => {
            await request('/auth/password', {
                method: 'POST', body: {
                    currentPassword: this.data.currentPassword, newPassword: this.data.newPassword
                }
            });
            this.setData({
                passwordOpen: false, currentPassword: '', newPassword: ''
            });
            toast('密码已修改，请恢复登录');
        });
        if (!this.data.error)
            await this.load();
    }
});
