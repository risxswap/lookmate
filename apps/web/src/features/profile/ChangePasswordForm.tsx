import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Space } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, write } from '../../api/client';

interface Fields { currentPassword: string; newPassword: string; confirmPassword: string }
const passwordLength = {
  validator: (_: unknown, value: string | undefined) => !value || (Array.from(value).length >= 8 && Array.from(value).length <= 64)
    ? Promise.resolve() : Promise.reject(new Error('密码须为 8～64 位')),
};

export function ChangePasswordForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<Fields>();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState<string>();
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (timestamp >= retryAt) { setRetryAt(0); setError(undefined); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  function close() {
    if (submitting.current) return;
    form.resetFields();
    setError(undefined);
    onClose();
  }

  async function submit(fields: Fields) {
    if (submitting.current || Date.now() < retryAt) return;
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      // 密码仅用于本次请求，不进入 Query mutation cache 或浏览器存储。
      await write<null>('/auth/password', { currentPassword: fields.currentPassword, newPassword: fields.newPassword });
    } catch (failure) {
      submitting.current = false;
      if (!mounted.current) return;
      setPending(false);
      setError(failure instanceof Error ? failure.message : '修改失败，请稍后重试');
      if (failure instanceof ApiError) {
        if (failure.detail.code === 'CURRENT_PASSWORD_INCORRECT') form.setFields([{ name: 'currentPassword', errors: ['原密码不正确'] }]);
        if (failure.detail.code === 'PASSWORD_CHANGED') setError('密码已被修改，请重新登录或核对最新密码后重试。');
        if (failure.detail.code === 'CSRF_INVALID') setError('安全凭证已刷新，请再次提交。');
        if (failure.detail.retryAfterSeconds) {
          const timestamp = Date.now();
          setNow(timestamp);
          setRetryAt(timestamp + failure.detail.retryAfterSeconds * 1000);
        }
        if (failure.detail.fieldErrors) form.setFields(failure.detail.fieldErrors
          .filter(item => item.field === 'currentPassword' || item.field === 'newPassword')
          .map(item => ({ name: item.field as keyof Fields, errors: [item.message] })));
      }
      return;
    }
    form.resetFields();
    try {
      await queryClient.cancelQueries();
    } finally {
      queryClient.clear();
      try { sessionStorage.removeItem('lookmate:hadSession'); } catch { /* 浏览器禁用存储时仍完成退出。 */ }
      // 整页跳转会丢弃旧 CSRF；凭证刷新不能将已成功的修改报告为失败。
      window.location.replace('/login?passwordChanged=1');
    }
  }

  return <Modal title="修改密码" open={open} onCancel={close} footer={null} closable={!pending} keyboard={!pending} mask={{ closable: !pending }} destroyOnHidden>
      <Alert className="form-alert" type="info" showIcon title="修改成功后，所有设备都需要使用新密码重新登录。" />
      {error || seconds > 0 ? <Alert className="form-alert" type="error" showIcon title={seconds > 0 ? `操作过于频繁，请在 ${seconds} 秒后重试` : error} /> : null}
      <Form form={form} name="change-password" layout="vertical" requiredMark={false} disabled={pending} onFinish={fields => void submit(fields)} clearOnDestroy>
        <Form.Item name="currentPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }, passwordLength]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="newPassword" label="新密码" dependencies={['currentPassword']} extra="8～64 位，支持空格，不强制字母、数字或符号组合。" rules={[
          { required: true, message: '请输入新密码' }, passwordLength,
          ({ getFieldValue }) => ({ validator: (_, value) => !value || value !== getFieldValue('currentPassword') ? Promise.resolve() : Promise.reject(new Error('新密码不能与原密码相同')) }),
        ]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="confirmPassword" label="确认新密码" dependencies={['newPassword']} rules={[
          { required: true, message: '请再次输入新密码' },
          ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue('newPassword') ? Promise.resolve() : Promise.reject(new Error('两次输入的新密码不一致')) }),
        ]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Space><Button type="primary" htmlType="submit" loading={pending} disabled={pending || seconds > 0}>确认修改</Button><Button onClick={close} disabled={pending}>取消</Button></Space>
      </Form>
    </Modal>;
}
