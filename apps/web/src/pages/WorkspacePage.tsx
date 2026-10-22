import { clearOutfitRecovery } from '../features/outfits/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Button, Dropdown, Menu, Spin } from 'antd';
import { clearNavigationSession, handleWorkspaceLink, useLocation } from '../app/navigation';
import { WorkspaceContent } from './WorkspaceContent';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { refreshCsrf, write } from '../api/client';
import { useAccount } from '../features/auth/queries';
import { loginUrl } from '../features/auth/navigation';
import { clearGenerationRecovery } from '../features/generation/api';
import { ChangePasswordForm } from '../features/profile/ChangePasswordForm';

export function WorkspacePage() {
  const location = useLocation();
  const account = useAccount();
  const queryClient = useQueryClient();
  const redirecting = useRef(false);
  const [error, setError] = useState<string>();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const expire = useCallback(async () => {
    if (redirecting.current) return;
    redirecting.current = true;
    const expired = sessionStorage.getItem('lookmate:hadSession') === '1';
    await queryClient.cancelQueries();
    queryClient.clear();
    sessionStorage.removeItem('lookmate:hadSession');
    clearNavigationSession();
    clearGenerationRecovery();
    clearOutfitRecovery();
    window.location.replace(loginUrl(expired));
  }, [queryClient]);
  useEffect(() => {
    if (redirecting.current) return;
    if (account.data === null) void expire();
    else if (account.data) sessionStorage.setItem('lookmate:hadSession', '1');
  }, [account.data, expire]);
  useEffect(() => {
    const listener = () => { void expire(); };
    window.addEventListener('lookmate:unauthenticated', listener);
    return () => window.removeEventListener('lookmate:unauthenticated', listener);
  }, [expire]);
  const logout = useMutation({
    mutationFn: () => write<void>('/auth/logout'),
    onSuccess: async () => {
      redirecting.current = true;
      await queryClient.cancelQueries();
      queryClient.clear();
      sessionStorage.removeItem('lookmate:hadSession');
    clearNavigationSession();
    clearGenerationRecovery();
    clearOutfitRecovery();
      try { await refreshCsrf(); } catch { /* 跳转后可以重新获取。 */ }
      sessionStorage.removeItem('lookmate:hadSession');
    clearNavigationSession();
    clearGenerationRecovery();
    clearOutfitRecovery();
      window.location.replace('/login');
    },
    onError: (failure: Error) => setError(failure.message),
  });
  if (account.isPending || account.data === null) return <main className="loading-page"><Spin description="正在恢复登录状态"><div className="loading-space" /></Spin></main>;
  if (account.isError) return <main className="loading-page"><Alert type="error" showIcon title="暂时无法读取账号信息" description={account.error.message} action={<Button onClick={() => void account.refetch()}>重试</Button>} /></main>;
  const path = location.pathname;
  const navigation = [
    { key: '/app', label: '工作台', symbol: 'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h6v6h-6z' },
    { key: '/app/designs', label: '设计记录', symbol: 'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5' },
    { key: '/app/wardrobe', label: '我的衣橱', symbol: 'M3 3h18v18H3z M12 3v18 M8 10v4 M16 10v4' },
    { key: '/app/profile', label: '个人资料', symbol: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2' },
  ];
  const isDesignDetail = /^\/app\/designs\/[^/]+$/.test(path);
  const selected = path.startsWith('/app/wardrobe/') ? '/app/wardrobe' : path === '/app/design/new' || isDesignDetail ? '/app/designs' : path;
  const currentAccount = account.data!;
  const displayName = currentAccount.displayName || currentAccount.username;
  return <div className="workspace-shell" onClick={handleWorkspaceLink}>
    <aside className="workspace-sidebar">
      <a className="brand workspace-brand" href="/app"><span className="brand-mark" aria-hidden>l.</span>Lookmate</a>
      <p className="sidebar-caption">个人形象设计</p>
      <nav aria-label="主导航"><Menu mode="inline" selectedKeys={[selected]} items={navigation.map(item => ({ key: item.key, icon: <svg className="nav-symbol" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.symbol} /></svg>, label: <a href={item.key} aria-current={selected === item.key ? 'page' : undefined}>{item.label}</a> }))} /></nav>
      <div className="sidebar-bottom">
        <Dropdown placement="topLeft" trigger={['click']} menu={{ items: [{ key: 'profile', label: <a href="/app/profile" onClick={handleWorkspaceLink}>个人资料</a> }, { key: 'password', label: '修改密码', onClick: () => setPasswordOpen(true) }, { type: 'divider' }, { key: 'logout', label: logout.isPending ? '正在退出…' : '退出登录', disabled: logout.isPending, onClick: () => logout.mutate() }] }}>
          <Button type="text" className="account-menu" aria-label="账号菜单" loading={logout.isPending}>
            <Avatar size={32} style={{ backgroundColor: '#e5eee7', color: '#315c50' }}>{Array.from(displayName)[0]}</Avatar>
            <span className="account-name" title={displayName}>{displayName}</span><span aria-hidden>⌃</span>
          </Button>
        </Dropdown>
      </div>
    </aside>
    <div className="workspace-body"><main className="workspace-content">{error ? <Alert className="form-alert" type="error" showIcon title={error} /> : null}<WorkspaceContent key={path} path={path} account={currentAccount} /></main></div>
    <ChangePasswordForm open={passwordOpen} onClose={() => setPasswordOpen(false)} />
  </div>;
}
