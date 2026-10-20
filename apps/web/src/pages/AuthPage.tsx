import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Spin, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, refreshCsrf, write, type Account } from '../api/client';
import { useAuthConfig } from '../features/auth/queries';
import { safeReturnTo } from '../features/auth/navigation';

interface Fields { username: string; password: string; confirmPassword?: string }
export function AuthPage({ registration }: { registration: boolean }) {
  const queryClient = useQueryClient();
  const config = useAuthConfig();
  const [form] = Form.useForm<Fields>();
  const [error, setError] = useState<string>();
  const [closed, setClosed] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const params = new URLSearchParams(window.location.search);
  const returnTo = safeReturnTo(params.get('returnTo'));
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (timestamp >= retryAt) { setRetryAt(0); setError(undefined); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const submit = useMutation({
    mutationFn: (fields: Fields) => write<Account>(registration ? '/auth/register' : '/auth/login', {
      username: fields.username, password: fields.password,
    }),
    onSuccess: async account => {
      form.resetFields(['password', 'confirmPassword']);
      if (registration) {
        window.location.replace(`/login?${new URLSearchParams({ registered: '1', username: account.username, returnTo })}`);
      } else {
        sessionStorage.setItem('lookmate:hadSession', '1');
        await queryClient.cancelQueries();
        queryClient.clear();
        // 身份已建立；刷新失败不把成功登录误报成凭据错误。
        try { await refreshCsrf(); } catch { /* 下一次写操作会重新获取 token。 */ }
        window.location.replace(returnTo);
      }
    },
    onError: (failure: Error) => {
      setError(failure.message);
      if (failure instanceof ApiError) {
        if (failure.detail.code === 'REGISTRATION_CLOSED') setClosed(true);
        if (failure.detail.retryAfterSeconds) { setNow(Date.now()); setRetryAt(Date.now() + failure.detail.retryAfterSeconds * 1000); }
        if (failure.detail.fieldErrors) form.setFields(failure.detail.fieldErrors.map(item => ({ name: item.field as keyof Fields, errors: [item.message] })));
      }
    },
  });
  const unavailable = registration && (closed || config.data?.registrationEnabled === false);
  return <main className="auth-layout">
    <div className="auth-intro"><p className="eyebrow">LOOKMATE · 个人形象设计</p><Typography.Title level={1}>从这里，发现<br />自己的更多可能。</Typography.Title><Typography.Paragraph>保存你的照片与衣橱，探索适合自己的发型和穿搭。</Typography.Paragraph></div>
    <Card className="auth-card">
      <Typography.Title level={2}>{registration ? '创建账号' : '欢迎回来'}</Typography.Title>
      <Typography.Paragraph type="secondary">{registration ? '用一个账号，开始记录你的风格。' : '登录 Lookmate，继续你的风格探索。'}</Typography.Paragraph>
      {registration && config.isPending ? <Spin description="正在加载注册设置"><div className="loading-space" /></Spin> :
        registration && config.isError ? <Alert type="error" showIcon title="暂时无法读取注册设置" action={<Button onClick={() => void config.refetch()}>重试</Button>} /> :
        unavailable ? <Alert type="info" showIcon title="暂未开放注册" /> : <>
          {!registration && params.get('registered') === '1' ? <Alert className="form-alert" type="success" showIcon title="注册成功，请登录" /> : null}
          {!registration && params.get('expired') === '1' ? <Alert className="form-alert" type="warning" showIcon title="登录已过期，请重新登录" /> : null}
          {error ? <Alert className="form-alert" type="error" showIcon title={seconds ? `操作过于频繁，请在 ${seconds} 秒后重试` : error} /> : null}
          <Form form={form} layout="vertical" requiredMark={false} initialValues={{ username: registration ? '' : params.get('username') ?? '' }} onFinish={fields => { setError(undefined); submit.mutate(fields); }}>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }, { pattern: /^[A-Za-z0-9_]{4,32}$/, message: '请输入 4～32 位英文字母、数字或下划线' }]} extra={registration ? '4～32 位英文字母、数字或下划线，不区分大小写' : undefined}>
              <Input autoComplete="username" autoCapitalize="none" spellCheck={false} size="large" maxLength={32} />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }, { validator: (_, value: string | undefined) => !value || (Array.from(value).length >= 8 && Array.from(value).length <= 64) ? Promise.resolve() : Promise.reject(new Error('密码须为 8～64 位')) }]} extra={registration ? '8～64 位，支持空格，不强制字母、数字或符号组合' : undefined}>
              <Input.Password autoComplete={registration ? 'new-password' : 'current-password'} size="large" />
            </Form.Item>
            {registration ? <Form.Item name="confirmPassword" label="确认密码" dependencies={['password']} rules={[{ required: true, message: '请再次输入密码' }, ({ getFieldValue }) => ({ validator: (_, value) => !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致')) })]}><Input.Password autoComplete="new-password" size="large" /></Form.Item> : null}
            <Button type="primary" htmlType="submit" block size="large" loading={submit.isPending} disabled={seconds > 0}>{registration ? '注册' : '登录'}</Button>
          </Form>
        </>}
      <div className="auth-switch">{registration ? <a href={`/login?${new URLSearchParams({ returnTo })}`}>已有账号？去登录</a> : config.data?.registrationEnabled ? <a href={`/register?${new URLSearchParams({ returnTo })}`}>还没有账号？创建账号</a> : null}</div>
    </Card>
  </main>;
}
