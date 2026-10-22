import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { ApiError, request } from '../../api/client';
import { navigate } from '../../app/navigation';
import type { TaskSummary } from '../workspace/queries';
import { persistPendingJob, readPendingJob, submitJob, type OutfitJob, type PendingOutfitJob } from './api';
export function OutfitJobRetry({ accountId, task }: { accountId: string; task: TaskSummary }) {
  const outfitId = task.outfitId!;
  const [pending, setPending] = useState(() => readPendingJob(accountId, outfitId)); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const guard = useRef(false); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function remember(value: PendingOutfitJob | null) { persistPendingJob(accountId, outfitId, value); setPending(value); }
  async function execute(value: PendingOutfitJob, find = false) {
    if (guard.current) return; guard.current = true; setBusy(true); setError('');
    try { if (!find) remember(value); const job = find ? await request<OutfitJob>(`/outfit-ai-jobs/by-request/${value.key}`) : await submitJob(value); remember(null); if (mounted.current) navigate(new URL(`/app/designs/${job.taskId}`, window.location.origin)); }
    catch (e) { if (!find && e instanceof ApiError && (e.status < 500 && e.detail.code !== 'IDEMPOTENCY_CONFLICT' || e.detail.code === 'GENERATION_UNAVAILABLE')) remember(null); setError((e as Error).message); }
    finally { guard.current = false; setBusy(false); }
  }
  return <><Space wrap><Button href={`/app/wardrobe/outfits/${outfitId}`}>查看原搭配</Button>{(['RETRY_FULL', 'RETRY_IMAGE'] as const).filter(a => task.actions.includes(a)).map(a => <Button key={a} disabled={!!pending || busy} onClick={() => void execute({ key: crypto.randomUUID(), outfitId, sourceId: task.id, body: { mode: a === 'RETRY_IMAGE' ? 'IMAGE_ONLY' : 'FULL' } })}>{a === 'RETRY_IMAGE' ? '重试效果图' : task.jobKind === 'EVALUATION' ? '重试文字评价' : '重试评价与效果图'}</Button>)}</Space>{pending ? <Alert type="warning" title="有提交结果待确认" action={<Space><Button loading={busy} onClick={() => void execute(pending, true)}>找回任务</Button><Button disabled={busy} onClick={() => void execute(pending)}>原键重发</Button></Space>} /> : null}{error ? <Alert type="error" title={error} /> : null}</>;
}
