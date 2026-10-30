import { getAccount, requireAccount } from '../lib/auth';
import { errorMessage } from '../lib/ui';
export type Event = WechatMiniprogram.CustomEvent;
export const value = (e: Event): string => String(e.detail.value ?? '');
export const id = (e: Event): string => String(e.currentTarget.dataset.id ?? '');
export const go = (e: Event): void => {
    wx.navigateTo({
        url: String(e.currentTarget.dataset.url)
    });
};
export const today = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export interface View {
    data: {
        busy?: boolean;
    };
    setData(data: Record<string, unknown>): void;
}
const owners = new WeakMap<object, string>();
/** A loaded page belongs to one account. Never apply late reads or writes to another account. */
export async function action(view: View, task: () => Promise<void>): Promise<void> {
    if (view.data.busy)
        return;
    const account = getAccount()?.id;
    const bound = owners.get(view);
    if (bound && account && bound !== account) {
        wx.reLaunch({
            url: '/pages/home/index'
        });
        return;
    }
    if (account)
        owners.set(view, account);
    const original = view.setData.bind(view);
    const expected = account || bound;
    const valid = () => !expected || getAccount()?.id === expected;
    view.setData = (data: Record<string, unknown>) => {
        if (valid())
            original(data);
        else if (!getAccount())
            original(Object.fromEntries(Object.entries(data).filter(([key]) => key === 'error' || key === 'busy')));
    };
    view.setData({
        busy: true, error: ''
    });
    try {
        await task();
        if (!account && getAccount()?.id)
            owners.set(view, getAccount()!.id);
    }
    catch (error) {
        view.setData({
            error: errorMessage(error)
        });
    }
    finally {
        view.setData = original;
        if (valid() || !getAccount())
            original({
                busy: false
            });
        else
            wx.reLaunch({
                url: '/pages/home/index'
            });
    }
}
export async function owner(): Promise<string | null> {
    return (await requireAccount())?.id || null;
}
export const stillOwner = (account: string): boolean => getAccount()?.id === account;
export const statusLabel: Record<string, string> = {
    QUEUED: '等待处理', PLANNING: '正在规划', GENERATING: '正在生成', SAVING: '正在保存', SUCCEEDED: '已完成', FAILED: '失败', UNKNOWN: '结果待确认', PENDING: '等待识别', RUNNING: '正在识别'
};
export const isActive = (status?: string): boolean => !!status && [
    'QUEUED', 'PLANNING', 'GENERATING', 'SAVING', 'PENDING', 'RUNNING'
].includes(status);
