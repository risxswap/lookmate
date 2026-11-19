import { useEffect, useRef, useState } from 'react';
import { Button, Spin, Tooltip, Typography } from 'antd';
import { request, type Account } from '../../api/client';
import { createQrLogin, type QrProgress, type QrTicket, type QrView } from './qrLogin';

const refreshLabel = '刷新登录码';
const refreshIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M20 4v5h-5m5 0a8.5 8.5 0 1 0 .2 5" />
</svg>;

interface QrFeedback {
  title: string;
  description?: string;
  action?: string;
  loading?: boolean;
}

function qrFeedback(view: QrView): QrFeedback | undefined {
  switch (view.status) {
    case 'PENDING': return;
    case 'LOADING': return { title: '正在获取登录码', loading: true };
    case 'CONFIRMED':
    case 'CLAIMING': return { title: '正在登录', loading: true };
    case 'CONSUMED': return { title: '登录成功，正在跳转' };
    case 'EXPIRED': return { title: '登录码已过期', description: '换一个新码，就能继续登录。', action: '重新获取' };
    case 'CANCELLED': return { title: '已取消登录', description: '如果还想登录，请获取新码。', action: '重新获取' };
    case 'ERROR':
      if (view.canRetryStatus) return { title: '还没收到登录结果', description: '如果已在小程序确认，先检查登录状态。', action: '检查登录状态' };
      if (view.ticket) return { title: '登录没能完成', description: '请重新获取登录码后再试。', action: '重新获取' };
      return { title: '暂时没能获取登录码', description: '可以重试，有密码也可以切到账号密码登录。', action: '重试' };
  }
}

export function WechatQrLogin({ onLogin }: { onLogin: (account: Account) => void }) {
  const [view, setView] = useState<QrView>({ status: 'LOADING' });
  const [hasRequestedRefresh, setHasRequestedRefresh] = useState(false);
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
  const scanTicket = view.status === 'PENDING' ? view.ticket : undefined;
  const feedback = qrFeedback(view);
  const canCheckStatus = view.status === 'ERROR' && view.canRetryStatus;
  const refreshing = hasRequestedRefresh && view.status === 'LOADING';
  const showRefreshIcon = !!scanTicket || refreshing;
  function handleAction() {
    if (refreshing) return;
    if (canCheckStatus) {
      lifecycle.current?.retryStatus();
    } else {
      setHasRequestedRefresh(true);
      void lifecycle.current?.refresh();
    }
  }
  return <div className="wechat-login">
    <div className="wechat-login-code">
      {scanTicket ? <img width={240} height={240} src={scanTicket.imageDataUrl} alt="微信登录小程序码" /> : null}
      <div className="wechat-login-state">
        <div role="status">
          {feedback ? <>
            {feedback.loading ? <div className="wechat-login-spinner"><Spin size="small" /></div> : null}
            <Typography.Text strong>{feedback.title}</Typography.Text>
            {feedback.description ? <Typography.Paragraph className="wechat-login-description" type="secondary">{feedback.description}</Typography.Paragraph> : null}
          </> : null}
        </div>
        {/* Keep the same button through a manual refresh so the focused control survives loading and failure. */}
        {showRefreshIcon || feedback?.action ? <Tooltip title={scanTicket ? refreshLabel : undefined} trigger={['hover', 'focus']}>
          <Button
            type={showRefreshIcon ? 'text' : 'link'}
            className={showRefreshIcon ? 'wechat-login-refresh' : undefined}
            aria-label={showRefreshIcon ? refreshLabel : undefined}
            aria-disabled={refreshing || undefined}
            icon={showRefreshIcon ? refreshIcon : undefined}
            onClick={handleAction}
          >{showRefreshIcon ? null : feedback?.action}</Button>
        </Tooltip> : null}
      </div>
    </div>
    {scanTicket ? <Typography.Paragraph className="wechat-login-caption" type="secondary">微信扫一扫，在小程序中确认登录</Typography.Paragraph> : null}
  </div>;
}
