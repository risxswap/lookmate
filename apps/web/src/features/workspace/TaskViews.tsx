import { Alert, Button, Descriptions, Empty, Space, Tag, Typography } from 'antd';
import { FavoriteAction } from '../designs/FavoriteAction';
import type { TaskStatus, TaskSummary } from './queries';

const labels: Record<TaskStatus, string> = {
  QUEUED: '等待中', PLANNING: '正在规划', GENERATING: '正在生成效果图', SAVING: '正在保存结果',
  SUCCEEDED: '已完成', FAILED: '失败', UNKNOWN: '结果待确认',
};
const colors: Record<TaskStatus, string> = {
  QUEUED: 'default', PLANNING: 'processing', GENERATING: 'processing', SAVING: 'processing',
  SUCCEEDED: 'success', FAILED: 'error', UNKNOWN: 'warning',
};
export const designTypeName = (type: string) => ({ OVERALL: '整体设计', HAIRSTYLE: '只改发型', OUTFIT: '只改穿搭' })[type] ?? type;
export function LocalTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}
export function StatusTag({ status }: { status: TaskStatus }) {
  return <Tag role="status" aria-live="polite" aria-atomic="true" color={colors[status] ?? 'default'}>{labels[status] ?? status}</Tag>;
}
export function QueryFailure({ error, stale, loading, retry }: { error: Error; stale: boolean; loading: boolean; retry: () => void }) {
  return <Alert className="feature-notice" type={stale ? 'warning' : 'error'} showIcon
    title={stale ? '刷新失败，以下为上次读取的数据，可能已过期' : '暂时无法读取设计数据'}
    description={error instanceof TypeError ? '网络连接失败，请检查网络后重试' : error.message} action={<Button loading={loading} onClick={retry}>重试</Button>} />;
}
export function TaskNotice({ task }: { task: TaskSummary }) {
  if (task.status !== 'FAILED' && task.status !== 'UNKNOWN' && !task.errorMessage && !task.errorCode) return null;
  return <Alert className="task-notice" showIcon type={task.status === 'FAILED' ? 'error' : 'warning'}
    title={task.status === 'UNKNOWN' ? '结果待确认' : task.status === 'FAILED' ? '设计任务失败' : '任务提示'}
    description={<>{task.errorMessage || (task.status === 'UNKNOWN' ? '当前结果尚未确认；不单独轮询此任务，可手动刷新查看最新状态。' : '暂未提供详细原因。')}{task.errorCode ? <div>错误代码：{task.errorCode}</div> : null}</>} />;
}
export function TaskCard({ task, accountId }: { task: TaskSummary; accountId: string }) {
  return <article className="task-record">
    <Space wrap><StatusTag status={task.status} /><Typography.Text type="secondary">{task.jobKind === 'EVALUATION' ? '搭配文字评价' : task.jobKind === 'IMAGE' ? '搭配效果图' : designTypeName(task.designType)}</Typography.Text></Space>
    <Typography.Title level={4}>{task.title || `${designTypeName(task.designType)}任务`}</Typography.Title>
    {task.summary ? <Typography.Paragraph className="task-text">{task.summary}</Typography.Paragraph> : null}
    <Typography.Paragraph type="secondary">创建于 <LocalTime value={task.createdAt} /></Typography.Paragraph>
    <TaskNotice task={task} />
    <Space wrap><FavoriteAction accountId={accountId} task={task} />
    {task.actions.includes('VIEW') ? <Button href={`/app/designs/${task.id}`}>查看详情</Button> : null}</Space>
  </article>;
}
export function TaskMetadata({ task }: { task: TaskSummary }) {
  return <Descriptions column={{ xs: 1, md: 2 }} items={[
    { key: 'id', label: '任务编号', children: task.id },
    { key: 'type', label: '设计方式', children: designTypeName(task.designType) },
    { key: 'created', label: '创建时间', children: <LocalTime value={task.createdAt} /> },
    { key: 'updated', label: '更新时间', children: <LocalTime value={task.updatedAt} /> },
  ]} />;
}
export function NoTasks({ recent = false }: { recent?: boolean }) {
  return <div className="blank-state"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>{recent ? '还没有设计记录' : '暂无进行中的任务'}</strong><p>{recent ? '从一次新的尝试开始，已完成、失败和待确认的任务会显示在这里。' : '开始设计后，可以在这里查看任务所处的阶段。'}</p></>}>
    {recent ? <Button href="/app/design/new">开始形象设计</Button> : null}
  </Empty></div>;
}
