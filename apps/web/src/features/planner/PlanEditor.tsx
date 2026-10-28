import { useRef, useState } from 'react';
import { Alert, Button, DatePicker, Empty, Input, Modal, Pagination, Skeleton, Tag } from 'antd';
import dayjs from 'dayjs';
import { ApiError, request } from '../../api/client';
import { OutfitBoard } from '../outfits/OutfitsList';
import { useOutfits, type Outfit } from '../outfits/api';
import { usePageBounds } from '../designs/queries';
import { SceneChoice } from './SceneChoice';
import { errorMessage, readPlanRecovery, savePlanRecovery, unknownWrite, useRefreshPlanner, type CreatePlan, type OutfitPlan } from './api';

export function PlanEditor({ accountId, date, plan, initialOutfit, recovery, onClose, onSaved }: {
  accountId: string; date: string; plan?: OutfitPlan; initialOutfit?: Outfit; recovery?: CreatePlan;
  onClose: () => void; onSaved: (date: string) => void;
}) {
  const [draftDate, setDate] = useState(recovery?.date || plan?.date || date);
  const [scene, setScene] = useState(recovery?.scene || plan?.scene || initialOutfit?.scenes?.[0] || '日常');
  const [note, setNote] = useState(recovery?.note || plan?.note || '');
  const [outfit, setOutfit] = useState<Outfit | null>(plan?.outfit || initialOutfit || null);
  const [outfitChanged, setOutfitChanged] = useState(!plan);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [pending, setPending] = useState<CreatePlan | null>(recovery || null);
  const lock = useRef(false);
  const query = useOutfits(accountId, page, '', 4);
  const refresh = useRefreshPlanner(accountId);
  usePageBounds(query.data?.total, 4, query.isSuccess && !query.isFetching, setPage);
  const disabled = busy || !!pending || blocked;
  const save = async () => {
    if (lock.current || blocked || !draftDate || !scene.trim()) return;
    lock.current = true; setBusy(true); setError('');
    let create: CreatePlan | null = null;
    try {
      if (plan) {
        await request<OutfitPlan>(`/outfit-plans/${plan.id}`, { method: 'PATCH', body: {
          version: plan.version, date: draftDate, scene: scene.trim(), note: note.trim() || null,
          ...(outfitChanged ? { outfitId: outfit?.id || null } : {}),
        } });
      } else {
        create = pending || { clientRequestId: crypto.randomUUID(), date: draftDate, scene: scene.trim(), note: note.trim() || null, outfitId: outfit?.id || null };
        savePlanRecovery(accountId, create);
        await request<OutfitPlan>('/outfit-plans', { method: 'POST', body: create });
        savePlanRecovery(accountId, null);
      }
      await refresh(); onSaved(create?.date || draftDate);
    } catch (failure) {
      setError(errorMessage(failure));
      if (unknownWrite(failure)) {
        if (!plan) setPending(create || readPlanRecovery(accountId));
        else setBlocked(true);
      } else {
        if (!plan) { savePlanRecovery(accountId, null); setPending(null); }
        if (failure instanceof ApiError && ['VERSION_CONFLICT', 'OUTFIT_PLAN_NOT_FOUND'].includes(failure.detail.code)) setBlocked(true);
      }
    } finally { lock.current = false; setBusy(false); }
  };
  return <Modal open title={plan ? '调整穿搭安排' : pending ? '找回待确认安排' : '添加穿搭安排'} onCancel={onClose} closable={!busy} keyboard={!busy} maskClosable={false} width={700}
    footer={<><Button disabled={busy} onClick={onClose}>{pending ? '稍后处理' : '取消'}</Button>{blocked ? <Button onClick={() => { void refresh(); onClose(); }}>关闭并刷新核对</Button> : <Button type="primary" loading={busy} disabled={!draftDate || !scene.trim()} onClick={() => void save()}>{pending ? '使用原请求重试' : '保存安排'}</Button>}</>}>
    <div className="planner-editor">
      {error && <Alert showIcon type="error" title={error} />}
      {pending && <Alert showIcon type="warning" title="上次保存结果尚未确认" description={`已保留 ${pending.date} · ${pending.scene} 的原请求，请使用原请求重试，避免重复安排。${pending.outfitId ? '原请求已选择搭配，重试会保留该选择。' : ''}`} />}
      {blocked && <Alert type="warning" title="请先核对最新安排" description="记录可能已变化或保存结果未知。本次输入仍保留；关闭并刷新核对后，再打开最新记录调整，不会自动覆盖。" />}
      <div className="planner-form-row"><label>日期<DatePicker aria-label="安排日期" value={dayjs(draftDate)} disabled={disabled} allowClear={false} onChange={d => { if (d) setDate(d.format('YYYY-MM-DD')); }} /></label><div><label>场景</label><SceneChoice accountId={accountId} value={scene} onChange={setScene} disabled={disabled} /></div></div>
      <label>备注 <span>选填</span><Input aria-label="安排备注" maxLength={80} value={note} disabled={disabled} onChange={e => setNote(e.target.value)} placeholder="例如：晚上与朋友吃饭" /></label>
      {!pending && <>
        <div className="planner-picker-heading"><strong>选择搭配</strong><Button type="link" disabled={disabled} onClick={() => { setOutfit(null); setOutfitChanged(true); }}>稍后再选</Button></div>
        <p className="planner-hint">{outfit ? `已选：${outfit.name}${plan && !outfitChanged ? '（保留安排时的组合与穿法）' : '（保存时复制当前组合与穿法）'}` : '暂未选择搭配，保存后可以继续补充。'}</p>
        {outfit?.items.some(item => item.missing) && <Tag color="orange">已选搭配有缺失单品</Tag>}
        {query.isError && <Alert type="error" title="无法读取常用搭配" description={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
        {query.isPending ? <Skeleton active /> : query.data && <>
          {query.data.total === 0 ? <Empty description={<span>还没有常用搭配，<a href="/app/wardrobe/outfits/new">先组合一套</a>，也可先保存场景。</span>} /> : <div className="planner-outfit-picker">{query.data.items.map(item => <div key={item.id} className={`planner-pick-card ${outfit?.id === item.id ? 'selected' : ''}`}><div className="planner-pick-image"><OutfitBoard accountId={accountId} outfit={item} /></div><Button block disabled={disabled} aria-pressed={outfit?.id === item.id} onClick={() => { setOutfit(item); setOutfitChanged(true); }}>{item.name}</Button>{item.items.some(i => i.missing) && <Tag color="orange">有缺失单品</Tag>}</div>)}</div>}
          {query.data.total > 4 && <Pagination size="small" current={page} pageSize={4} total={query.data.total} showSizeChanger={false} onChange={setPage} />}
        </>}
      </>}
    </div>
  </Modal>;
}
