import { requireAccount } from '../../lib/auth';
import { assertAccount, request } from '../../lib/request';
import { errorMessage, toast } from '../../lib/ui';
import { value, type Event } from '../../features/page';
import type { Account } from '../../types/api';

const openPages = new WeakSet<object>();

Page({
    data: {
        account: null as Account | null,
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        busy: false,
        error: ''
    },
    onLoad() {
        openPages.add(this);
        return this.load();
    },
    onUnload() {
        openPages.delete(this);
    },
    async load() {
        if (this.data.busy) return;
        this.setData({ busy: true, error: '' });
        try {
            const account = await requireAccount();
            if (openPages.has(this)) this.setData({ account, error: account ? '' : '请先登录' });
        } catch (error) {
            if (openPages.has(this)) this.setData({ error: errorMessage(error) });
        } finally {
            if (openPages.has(this)) this.setData({ busy: false });
        }
    },
    field(event: Event) {
        const key = event.currentTarget.dataset.key;
        if (!this.data.busy && (key === 'currentPassword' || key === 'newPassword' || key === 'confirmPassword')) {
            this.setData({ [key]: value(event) });
        }
    },
    async savePassword() {
        const { account, busy, currentPassword, newPassword, confirmPassword } = this.data;
        if (!openPages.has(this) || busy || !account?.hasPassword || !currentPassword || !newPassword) return;
        if (newPassword !== confirmPassword) return;

        this.setData({ busy: true, error: '' });
        try {
            assertAccount(account.id);
            await request('/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
            if (!openPages.has(this)) return;

            this.setData({ currentPassword: '', newPassword: '', confirmPassword: '' });
            const success = () => toast('密码已修改');
            const pages = getCurrentPages();
            if (pages[pages.length - 2]?.route === 'pages/me/index') wx.navigateBack({ success });
            else wx.switchTab({ url: '/pages/me/index', success });
        } catch (error) {
            if (openPages.has(this)) this.setData({ error: errorMessage(error) });
        } finally {
            if (openPages.has(this)) this.setData({ busy: false });
        }
    }
});
