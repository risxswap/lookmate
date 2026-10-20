import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Space, Spin, Tag, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { refreshCsrf, write } from '../api/client';
import { useAccount } from '../features/auth/queries';
import { loginUrl } from '../features/auth/navigation';

export function WorkspacePage() {
  const account = useAccount();
  const queryClient = useQueryClient();
  const redirecting = useRef(false);
  const [error, setError] = useState<string>();
  const expire = useCallback(async () => {
    if (redirecting.current) return;
    redirecting.current = true;
    const expired = sessionStorage.getItem('lookmate:hadSession') === '1';
    await queryClient.cancelQueries();
    queryClient.clear();
    sessionStorage.removeItem('lookmate:hadSession');
    window.location.replace(loginUrl(expired));
  }, [queryClient]);
  useEffect(() => {
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
      await queryClient.cancelQueries();
      queryClient.clear();
      sessionStorage.removeItem('lookmate:hadSession');
      try { await refreshCsrf(); } catch { /* 跳转后可以重新获取。 */ }
      window.location.replace('/login');
    },
    onError: (failure: Error) => setError(failure.message),
  });
  if (account.isPending || account.data === null) return <main className="loading-page"><Spin description="正在恢复登录状态"><div className="loading-space" /></Spin></main>;
  if (account.isError) return <main className="loading-page"><Alert type="error" showIcon title="暂时无法读取账号信息" description={account.error.message} action={<Button onClick={() => void account.refetch()}>重试</Button>} /></main>;
  return <main>
    <section className="intro workspace-intro"><div><p className="eyebrow">我的工作台</p><Typography.Title>你好，{account.data?.displayName ?? account.data?.username}</Typography.Title><Typography.Paragraph>从你的照片和衣橱出发，发现新的风格。</Typography.Paragraph></div><Button onClick={() => logout.mutate()} loading={logout.isPending}>退出登录</Button></section>
    {error ? <Alert className="form-alert" type="error" showIcon title={error} /> : null}
    <div className="tool-grid"><Card title="发型设计"><Typography.Paragraph>结合本人照片，尝试适合你的新发型。</Typography.Paragraph><Tag>即将开放</Tag></Card><Card title="穿搭设计"><Typography.Paragraph>用你已有的衣物，发现日常穿着的新组合。</Typography.Paragraph><Tag>即将开放</Tag></Card></div>
    <Space className="notice"><Typography.Text type="secondary">照片、衣橱和设计功能将陆续开放。</Typography.Text></Space>
  </main>;
}
