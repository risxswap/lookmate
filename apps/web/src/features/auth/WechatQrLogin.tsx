import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Spin, Typography } from 'antd';
import { request, type Account } from '../../api/client';
import { createQrLogin, type QrProgress, type QrTicket, type QrView } from './qrLogin';

export function WechatQrLogin({ onLogin }: { onLogin: (account: Account) => void }) {
  const [view, setView] = useState<QrView>({ status: 'LOADING' });
  const lifecycle = useRef<ReturnType<typeof createQrLogin> | null>(null);
  const success = useRef(onLogin); success.current = onLogin;
  useEffect(() => {
    const flow = createQrLogin({
      create: signal => request<QrTicket>('/auth/qr', { method: 'POST', body: {}, signal }),
      status: (id, signal) => request<QrProgress>(`/auth/qr/${encodeURIComponent(id)}`, { signal }),
      claim: (id, signal) => request<Account>(`/auth/qr/${encodeURIComponent(id)}/claim`, { method: 'POST', body: {}, signal }),
      account: signal => request<Account>('/auth/me', { signal }),
    }, setView, account => success.current(account));
    lifecycle.current = flow;
    // Defer creation so a discarded StrictMode mount cannot race the real browser request.
    const start = window.setTimeout(() => void flow.refresh(), 0);
    return () => { window.clearTimeout(start); flow.stop(); lifecycle.current = null; };
  }, []);
  const pending = view.status === 'PENDING';
  const busy = view.status === 'LOADING' || view.status === 'CLAIMING';
  const title = view.status === 'EXPIRED' ? '登录码已过期' : view.status === 'CANCELLED' ? '已取消登录' : view.status === 'CONSUMED' ? '登录完成' : view.status === 'CLAIMING' ? '正在登录…' : '请使用微信扫一扫';
  return <div className="wechat-login">
    <div className="wechat-login-code" aria-busy={busy}>
      {pending && view.ticket ? <img width={240} height={240} src={view.ticket.imageDataUrl} alt="微信登录小程序码" /> : busy ? <Spin description={view.status === 'LOADING' ? '正在获取登录码' : '正在登录'}><div className="wechat-login-placeholder" /></Spin> : <Typography.Text type="secondary">{view.status === 'ERROR' ? '登录码暂时不可用' : title}</Typography.Text>}
    </div>
    <Typography.Paragraph className="wechat-login-status" aria-live="polite">{title}</Typography.Paragraph>
    {pending ? <Typography.Paragraph type="secondary">在小程序中确认登录，登录码 5 分钟有效。</Typography.Paragraph> : null}
    {view.error ? <Alert type="error" showIcon title={view.error} /> : null}
    <Space wrap>
      <Button disabled={busy || view.status === 'CONSUMED'} onClick={() => void lifecycle.current?.refresh()}>刷新登录码</Button>
      {view.status === 'ERROR' && view.canRetryStatus ? <Button onClick={() => lifecycle.current?.retryStatus()}>重试查询状态</Button> : null}
    </Space>
  </div>;
}
