export interface Account { id: string; username: string | null; displayName: string | null; hasPassword: boolean; wechatBound: boolean; avatarFileId: string | null }
export interface Session { token: string; expiresAt: string; account: Account }
const KEY = 'lookmate:mini:session:v1';
let current: Session | null | undefined;
export function session(): Session | null {
  if (current === undefined) {
    const value = wx.getStorageSync(KEY) as Partial<Session> | undefined;
    current = value && typeof value.token === 'string' && typeof value.expiresAt === 'string' && typeof value.account?.id === 'string' ? value as Session : null;
  }
  return current;
}
export function saveSession(value: Session): void { wx.setStorageSync(KEY, value); current = value; }
export function clearSession(): void { wx.removeStorageSync(KEY); current = null; }
export function updateAccount(account: Account): void { const old = session(); if (old && old.account.id === account.id) saveSession({...old, account}); }
export function validSession(): boolean { const value = session(); return !!value && Date.parse(value.expiresAt) > Date.now(); }
