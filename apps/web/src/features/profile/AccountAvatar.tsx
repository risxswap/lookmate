import { useEffect, useState } from 'react';
import { Avatar, Button, Modal, Space, Typography, Alert } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, request, type Account } from '../../api/client';
import { accountKey } from '../auth/queries';
import { ImageUpload, usableImage, type ImageDraft } from '../wardrobe/ImageUpload';
import { PrivateImage } from '../wardrobe/PrivateImage';

export function AccountAvatar({ account }: { account: Account }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ImageDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [notice, setNotice] = useState('');
  const [expected, setExpected] = useState<string | null>(null);
  const uploading = items.some(item => ['SENDING', 'COMPLETING'].includes(item.status));
  useEffect(() => {
    if (!busy && !uploading) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, uploading]);
  function updated(next: Account) { client.setQueryData(accountKey, next); setOpen(false); setItems([]); setError(''); setUnknown(false); setNotice('账号头像已保存，不影响设计照片。'); }
  async function save(fileId: string | null) {
    if (busy || uploading || unknown) return;
    setBusy(true); setError(''); setExpected(fileId);
    try { updated(await request<Account>('/profile/avatar', { method: 'PUT', body: { fileId } })); }
    catch (failure) {
      if (!(failure instanceof ApiError) || failure.status >= 500) { setUnknown(true); setError('保存结果尚未确认，请先查询账号状态，勿重复保存。'); }
      else setError(failure.message);
    } finally { setBusy(false); }
  }
  async function reconcile() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await request<Account>('/auth/me');
      client.setQueryData(accountKey, next);
      if (next.avatarFileId === expected) updated(next);
      else { setUnknown(false); setError('已读取当前头像，与本次选择不同；请核对后决定是否再次保存。'); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '账号状态读取失败，请重试'); }
    finally { setBusy(false); }
  }
  return <section className="account-avatar-editor" aria-label="账号头像">
    <div className="account-avatar-image">{account.avatarFileId ? <PrivateImage accountId={account.id} fileId={account.avatarFileId} alt="账号头像" thumbnail hideRefresh /> : <Avatar size={72}>我</Avatar>}</div>
    <div><Typography.Text strong>账号头像</Typography.Text><Typography.Paragraph type="secondary">与小程序共用，不替换用于设计的本人照片。</Typography.Paragraph>
      <Space><Button onClick={() => { setError(''); setNotice(''); setOpen(true); }}>修改头像</Button>{account.avatarFileId ? <Button disabled={busy || unknown} loading={busy} onClick={() => void save(null)}>使用默认头像</Button> : null}</Space>
      {notice ? <Typography.Paragraph role="status">{notice}</Typography.Paragraph> : null}
      {error && !open ? <Alert type="error" title={error} action={unknown ? <Button loading={busy} onClick={() => void reconcile()}>查询保存结果</Button> : undefined} /> : null}
    </div>
    <Modal title="修改账号头像" open={open} onCancel={() => { if (!busy && !uploading) { setOpen(false); if (!unknown) setItems([]); } }} closable={!busy && !uploading} keyboard={!busy && !uploading} mask={{ closable: !busy && !uploading }} footer={null} destroyOnHidden>
      <Typography.Paragraph>选择一张图片作为账号头像，上传完成后点击保存。</Typography.Paragraph>
      <ImageUpload accountId={account.id} items={items} setItems={setItems} disabled={busy || unknown} maxFiles={1} mode="photo" />
      {error ? <Alert type="error" title={error} /> : null}
      <Space style={{ marginTop: 16 }}>{unknown ? <Button loading={busy} onClick={() => void reconcile()}>查询保存结果</Button> : <Button type="primary" loading={busy} disabled={!items[0] || !usableImage(items[0]) || uploading} onClick={() => void save(items[0].fileId!)}>保存头像</Button>}<Button disabled={busy || uploading} onClick={() => setOpen(false)}>关闭</Button></Space>
    </Modal>
  </section>;
}
