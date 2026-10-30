import { Feedback } from '../../components/Feedback';
import { Button, Popconfirm } from 'antd';
import type { TaskSummary } from '../workspace/queries';
import { useRecordWrite } from './queries';
export function FavoriteAction({ accountId, task }: { accountId: string; task: TaskSummary }) {
  const mutation = useRecordWrite(accountId);
  if (!task.resultId || !task.actions.some(a => a === 'FAVORITE' || a === 'UNFAVORITE')) return null;
  const remove = task.actions.includes('UNFAVORITE');
  const submit = () => mutation.mutate({ path: `/favorites/${task.resultId}`, method: remove ? 'DELETE' : 'PUT' });
  const button = <Button loading={mutation.isPending} onClick={remove ? undefined : submit}>{remove ? '取消收藏' : task.designType === 'HAIRSTYLE' ? '收藏效果' : '收藏方案'}</Button>;
  return <><span>{remove ? <Popconfirm title="取消收藏？" description="将移出全部收藏夹，设计方案仍会保留。" onConfirm={submit} okText="取消收藏" cancelText="保留">{button}</Popconfirm> : button}</span>{mutation.isError ? <Feedback eventKey={mutation.error} type="error" title={mutation.error.message} /> : null}</>;
}
