import { useRef, useState } from 'react';
import { Button, Dropdown, Modal, type MenuProps } from 'antd';
import { Feedback } from '../../components/Feedback';
import { navigate } from '../../app/navigation';
import type { TaskSummary } from '../workspace/queries';
import { useRecordWrite } from './queries';

type Confirmation = 'DELETE' | 'HIDE' | 'UNFAVORITE';
export function RecordActions({ accountId, task, onManage, onViewMetadata, detail = false }: {
  accountId: string; task: TaskSummary; onManage?: () => void; onViewMetadata?: () => void; detail?: boolean;
}) {
  const mutation = useRecordWrite(accountId);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const submitting = useRef(false);
  const allowed = (action: string) => task.actions.includes(action);
  const submit = async (action: string) => {
    if (submitting.current || !allowed(action)) return;
    submitting.current = true;
    try {
      const removing = action === 'DELETE' || action === 'HIDE';
      await mutation.mutateAsync({
        path: removing ? `/designs/${task.id}${action === 'HIDE' ? '/hide' : ''}` : `/favorites/${task.resultId}`,
        method: action === 'HIDE' ? 'POST' : action === 'FAVORITE' ? 'PUT' : 'DELETE',
      });
      setConfirmation(null);
      if (detail && removing) navigate(new URL('/app/designs', window.location.origin), true);
    } catch { /* The mutation error remains visible with the confirmation. */ }
    finally { submitting.current = false; }
  };
  const items: MenuProps['items'] = [];
  if (onViewMetadata) items.push({ key: 'METADATA', label: '任务信息' });
  if (!detail && allowed('VIEW')) items.push({ key: 'VIEW', label: <a href={`/app/designs/${task.id}`}>查看详情</a> });
  if (!detail && task.resultId) {
    if (allowed('FAVORITE')) items.push({ key: 'FAVORITE', label: '收藏方案' });
    if (allowed('UNFAVORITE')) items.push({ key: 'UNFAVORITE', label: '取消收藏' });
  }
  if (onManage) items.push({ key: 'MANAGE', label: '管理归属' });
  if (allowed('DELETE') || allowed('HIDE')) {
    if (items.length) items.push({ type: 'divider' });
    if (allowed('DELETE')) items.push({ key: 'DELETE', label: '删除记录', danger: true });
    if (allowed('HIDE')) items.push({ key: 'HIDE', label: '隐藏记录', danger: true });
  }
  if (!items.length && !confirmation) return null;
  const label = confirmation === 'HIDE' ? '隐藏记录' : confirmation === 'UNFAVORITE' ? '取消收藏' : '删除记录';
  return <>
    <Dropdown trigger={['click']} menu={{ items, onClick: ({ key }) => {
      mutation.reset();
      if (key === 'METADATA') onViewMetadata?.();
      else if (key === 'MANAGE') onManage?.();
      else if (key === 'FAVORITE') void submit(key);
      else if (key === 'DELETE' || key === 'HIDE' || key === 'UNFAVORITE') setConfirmation(key);
    } }} disabled={mutation.isPending}>
      <Button type="text" loading={mutation.isPending} aria-label={`${task.title || '设计记录'}更多操作`}>•••</Button>
    </Dropdown>
    {confirmation ? <Modal open title={`${label}？`} okText={label} cancelText="取消"
      onCancel={() => setConfirmation(null)} onOk={() => void submit(confirmation)}
      confirmLoading={mutation.isPending} okButtonProps={{ danger: true, disabled: !allowed(confirmation) }}
      cancelButtonProps={{ disabled: mutation.isPending }} closable={!mutation.isPending} keyboard={!mutation.isPending} maskClosable={false}>
      <p>{confirmation === 'HIDE' ? '记录将从列表隐藏，后台调用不会取消。结果确认后或隐藏满七天后清理相关数据，不会重新显示。' : confirmation === 'UNFAVORITE' ? '将移出全部收藏夹，设计方案仍会保留。' : `此记录${task.resultId ? '及已生成的设计结果' : ''}将被删除${task.favoriteId ? '，同时移出全部收藏夹' : ''}，无法恢复。本人照片、衣橱单品和已保存的常用搭配不受影响。`}</p>
      {!allowed(confirmation) ? <p>记录状态已变化，此操作当前不可用，请取消并刷新。</p> : null}
      {mutation.isError ? <Feedback eventKey={mutation.error} type="error" title={mutation.error.message} description="操作未完成，请重试或取消。" /> : null}
    </Modal> : mutation.isError ? <Feedback eventKey={mutation.error} type="error" title={mutation.error.message} /> : null}
  </>;
}
