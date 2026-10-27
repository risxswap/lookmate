import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Popconfirm, Popover, Space, Typography } from 'antd';
import { request } from '../../api/client';
import { recognitionLabels, useWardrobeWrite, type Dress } from './queries';

export function RecognitionNotice({ accountId, dress, onDetail }: { accountId: string; dress: Dress; onDetail: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const client = useQueryClient();
  const write = useWardrobeWrite(accountId);
  const refresh = useMutation({
    mutationFn: () => request<Dress>(`/dresses/${dress.id}`),
    onSuccess: async value => {
      client.setQueryData(['dress', accountId, dress.id], value);
      await client.invalidateQueries({ queryKey: ['dresses', accountId] });
    },
  });
  const recognition = dress.recognition;
  if (!recognition || recognition.status === 'SUCCEEDED') return null;
  const retryable = ['FAILED', 'UNKNOWN'].includes(recognition.status);
  const pending = ['PENDING', 'RUNNING'].includes(recognition.status);
  const label = recognitionLabels[recognition.status] ?? '识别状态待确认';
  const busy = write.isPending || refresh.isPending;
  const error = write.error ?? refresh.error;
  const content = <div className="wardrobe-recognition-content" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape' && !confirming) setOpen(false); }}>
    <Typography.Paragraph>{recognition.errorMessage || (pending ? '识别完成后会自动更新，请稍候。' : '暂时没有更多识别信息，可刷新单品核对当前状态。')}</Typography.Paragraph>
    {recognition.status === 'UNKNOWN' ? <Typography.Paragraph type="secondary">上次请求结果尚未确认，请先刷新单品核对；重试可能再次调用识别服务。</Typography.Paragraph> : null}
    {error ? <Alert type="error" showIcon title={error.message} /> : null}
    <Space wrap>
      {retryable ? <><Button size="small" disabled={busy} loading={refresh.isPending} onClick={() => { write.reset(); refresh.mutate(); }}>刷新单品</Button><Popconfirm
        open={confirming}
        onOpenChange={value => { if (!busy) setConfirming(value); }}
        title={recognition.status === 'UNKNOWN' ? '确认重新识别？' : '重新识别这些图片？'}
        description={recognition.status === 'UNKNOWN' ? '上次请求结果尚未确认，重试可能再次调用识别服务。请先刷新单品确认当前状态。' : '重新识别不会覆盖你的人工修订。'}
        okText="确认重试" cancelText="取消"
        okButtonProps={{ loading: write.isPending, disabled: busy }}
        cancelButtonProps={{ disabled: busy }}
        onConfirm={() => {
          if (busy) return;
          refresh.reset();
          write.mutate({ path: `/dresses/${dress.id}/recognition-retry`, method: 'POST', body: { recognitionId: recognition.id, ...(recognition.status === 'UNKNOWN' ? { confirmUnknown: true } : {}) } }, { onSettled: () => setConfirming(false) });
        }}
      ><Button size="small" disabled={busy} loading={write.isPending}>重新识别</Button></Popconfirm></> : null}
      <Button size="small" type="link" disabled={busy} onClick={() => { setOpen(false); setConfirming(false); onDetail(); }}>查看单品详情</Button>
    </Space>
  </div>;
  return <Popover title={label} content={content} trigger="click" placement="bottomRight" open={open} onOpenChange={value => { if (!confirming && !busy) { setOpen(value); if (value) { write.reset(); refresh.reset(); } } }}>
    <Button type="text" shape="circle" className={`wardrobe-recognition-badge${pending ? ' is-pending' : ''}`} aria-label={`${dress.name}：${label}，点击查看详情`} title={`${label}，点击查看详情`} aria-expanded={open} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { setConfirming(false); setOpen(false); } }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">{pending ? <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></> : <><circle cx="12" cy="12" r="8" /><path d="M12 7v6m0 4h.01" /></>}</svg>
    </Button>
  </Popover>;
}
