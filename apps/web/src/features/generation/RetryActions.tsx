import { Feedback } from '../../components/Feedback';
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Space } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { navigate } from '../../app/navigation';
import { completeOutfitSubmission } from '../outfitInspirations/drafts';
import { completeHairSubmission } from '../hairstyles/drafts';
import type { TaskSummary } from '../workspace/queries';
import { clearPending, findSubmission, readPending, savePending, sendSubmission, type PendingSubmission, type Submission } from './api';

export function RetryActions({ accountId, task }: { accountId: string; task: TaskSummary }) {
  const [pending, setPending] = useState<PendingSubmission | null>(() => readPending(accountId));
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const guard = useRef(false);
  const mounted = useRef(true);
  const client = useQueryClient();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function done(value: Submission, operation?: PendingSubmission) {
    completeOutfitSubmission(accountId, operation);
    completeHairSubmission(accountId, operation);
    clearPending(accountId);
    void client.invalidateQueries({ queryKey: ['designs', accountId] });
    void client.invalidateQueries({ queryKey: ['workspace', accountId] });
    if (mounted.current) navigate(new URL(`/app/designs/${value.taskId}`, window.location.origin));
  }
  async function recover() {
    if (!pending || guard.current) return;
    guard.current = true; setBusy(true); setNotFound(false); setError('');
    try { done(await findSubmission(pending.key), pending); }
    catch (failure) {
      if (mounted.current) {
        setNotFound(failure instanceof ApiError && failure.status === 404);
        setError(failure instanceof ApiError && failure.status === 404 ? '暂未找到原提交，可以使用原编号重新提交。' : failure instanceof Error ? failure.message : '查询失败');
      }
    } finally { guard.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => { if (pending?.kind === 'RETRY' && pending.sourceId === task.id) void recover(); }, []);
  async function submit(mode: 'FULL' | 'IMAGE_ONLY') {
    if (guard.current) return;
    const saved = readPending(accountId);
    if (saved && !(saved.kind === 'RETRY' && saved.sourceId === task.id && saved.mode === mode && notFound)) {
      setPending(saved); setError('有一笔提交尚未确认，请先找回它。'); return;
    }
    guard.current = true; setBusy(true); setError('');
    const operation: PendingSubmission = saved || { accountId, key: crypto.randomUUID(), kind: 'RETRY', sourceId: task.id, mode };
    try {
      savePending(operation); setPending(operation); setNotFound(false);
      done(await sendSubmission(operation), operation);
    } catch (failure) {
      if (mounted.current) {
        if (failure instanceof ApiError && failure.status < 500 && failure.detail.code !== 'IDEMPOTENCY_CONFLICT') { clearPending(accountId); setPending(null); }
        setError(failure instanceof Error ? failure.message : '重试提交结果未确认，请查询原提交');
      }
    } finally { guard.current = false; if (mounted.current) setBusy(false); }
  }
  const confirm = (mode: 'FULL' | 'IMAGE_ONLY') => Modal.confirm({ title: mode === 'FULL' ? '使用原输入重新规划？' : '复用原方案重试生图？', content: mode === 'FULL' ? '将创建关联原任务的新任务，沿用当时的照片、衣橱、资料和要求，不读取后来的修改。' : '将创建新任务，完整复用已保存的文字方案与参考图片，不重新选衣。', okText: '确认重试', cancelText: '取消', onOk: () => submit(mode) });
  return <>
    <Space wrap>
      {task.actions.includes('NEW_FROM_INPUT') ? <Button disabled={busy || !!pending} href={`${task.designType === 'HAIRSTYLE' ? '/app/hairstyles/try' : task.designType === 'OUTFIT' ? '/app/outfit-design/try' : '/app/design/new'}?from=${task.id}`} >{task.designType === 'HAIRSTYLE' ? '调整后再试' : '修改要求再设计'}</Button> : null}
      {task.actions.includes('RETRY_FULL') ? <Button disabled={!!pending} loading={busy} onClick={() => confirm('FULL')}>重新规划并生成</Button> : null}
      {task.actions.includes('RETRY_IMAGE') ? <Button disabled={!!pending} loading={busy} onClick={() => confirm('IMAGE_ONLY')}>仅重试效果图</Button> : null}
    </Space>
    {pending ? <Feedback type="warning" title="有一笔提交等待确认" description={<Space wrap><Button loading={busy} onClick={() => void recover()}>查询原提交</Button>{notFound && pending.kind === 'RETRY' && pending.sourceId === task.id ? <Button disabled={busy} onClick={() => void submit(pending.mode)}>使用原编号重提</Button> : null}<Button href={pending.kind === 'RETRY' ? `/app/designs/${pending.sourceId}` : pending.input.designType === 'HAIRSTYLE' ? '/app/hairstyles/try' : pending.input.designType === 'OUTFIT' ? '/app/outfit-design/try' : '/app/design/new'}>查看恢复记录</Button></Space>} /> : null}
    {error ? <Feedback type="error" title={error} /> : null}
  </>;
}
