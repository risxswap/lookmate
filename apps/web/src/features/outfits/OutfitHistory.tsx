import type { ReactNode } from 'react';
import { Alert, Button, Collapse, Drawer, Empty, Pagination, Skeleton, Space, Tag, Typography } from 'antd';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { StatusTag } from '../workspace/TaskViews';
import { isActive } from '../workspace/queries';
import type { Outfit, OutfitJob } from './api';

interface Props {
  accountId: string;
  outfit: Outfit;
  open: boolean;
  onClose: () => void;
  jobs: OutfitJob[];
  total?: number;
  page: number;
  onPage: (page: number) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  currentImageTaskId?: string;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  onRefresh: () => void;
  retryDisabled: boolean;
  submissionFeedback: ReactNode;
  onRetry: (job: OutfitJob, mode: 'IMAGE_ONLY' | 'FULL') => void;
}

export function OutfitHistory(props: Props) {
  const { accountId, outfit, jobs, selected, onSelect } = props;
  return <Drawer title="生成历史" open={props.open} onClose={props.onClose} size="min(760px, 100vw)"
    className="outfit-history" styles={{ wrapper: { maxWidth: '100vw' } }}
    extra={<Button onClick={props.onRefresh} loading={props.refreshing}>刷新任务</Button>}
    footer={props.total !== undefined && props.total > 0 ? <Pagination current={props.page} pageSize={5} total={props.total} showSizeChanger={false}
      showTotal={total => `共 ${total} 条记录`} onChange={page => { onSelect(null); props.onPage(page); }} /> : null}>
    <div className="outfit-history-intro"><Typography.Text strong>{outfit.name}</Typography.Text><Typography.Paragraph type="secondary">每次生成独立保留，当前搭配版本下最新成功的效果图会展示在详情中。</Typography.Paragraph></div>
    {outfit.sourceOutputFileId && outfit.revision !== '0' && <Collapse className="outfit-history-source" items={[{key: 'source', label: '原设计效果图 · 对应修改前搭配', children: <PrivateImage hideRefresh accountId={accountId} fileId={outfit.sourceOutputFileId} alt="原设计效果图，对应修改前搭配" />}]} />}
    {props.error && <Alert showIcon type="error" title="生成历史暂时无法加载" description={props.error} action={<Button onClick={props.onRefresh}>重新加载</Button>} />}
    {props.loading ? <Skeleton active paragraph={{ rows: 5 }} /> : !props.error && props.total === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>还没有生成记录</strong><p>评价搭配或生成效果图后，可以在这里查看。</p></>} /> : null}
    {props.submissionFeedback}
    <div className="outfit-history-list">{jobs.map(job => {
      const active = isActive(job.status);
      const stale = job.stale || job.revision !== outfit.revision;
      const expanded = selected === job.taskId && !active;
      const hasResult = !!job.result || !!job.outputFileId;
      const current = !stale && job.taskId === props.currentImageTaskId;
      const retryActions = active ? [] : (['RETRY_FULL', 'RETRY_IMAGE'] as const).filter(action => job.actions.includes(action));
      return <article className={`outfit-history-card${current ? ' is-current' : ''}`} key={job.taskId} aria-label={`${job.kind === 'EVALUATION' ? '文字评价' : '上身效果图'} ${job.taskId}`}>
        <div className="outfit-history-card-heading"><div><Typography.Text strong>{job.kind === 'EVALUATION' ? '文字评价' : '上身效果图'}</Typography.Text><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString()}</time></div><Space wrap size={[4, 4]}><StatusTag status={job.status} />{current && <Tag color="green">当前展示</Tag>}{stale && <Tag>修改前的搭配</Tag>}</Space></div>
        {(hasResult || active) && <div className="outfit-history-overview">
          {job.outputFileId && !active && <div className="outfit-history-thumbnail"><PrivateImage hideRefresh compact thumbnail accountId={accountId} fileId={job.outputFileId} alt="历史效果图缩略图" onOpen={() => onSelect(job.taskId)} /></div>}
          <div className="outfit-history-summary">{active ? <Typography.Paragraph type="secondary">正在处理，可离开页面，任务会继续执行。</Typography.Paragraph> : <>
            <Typography.Paragraph className={expanded ? '' : 'outfit-history-excerpt'}>{job.result?.summary || '已生成这套搭配的上身效果图。'}</Typography.Paragraph>
            <Button type="link" onClick={() => onSelect(expanded ? null : job.taskId)} aria-expanded={expanded} aria-controls={`outfit-history-result-${job.taskId}`}>{expanded ? '收起详情' : job.outputFileId ? '查看效果与建议' : '查看详细建议'}</Button>
          </>}</div>
        </div>}
        {!active && job.status === 'UNKNOWN' && <Alert showIcon type="warning" title="生成结果待确认" description="已停止自动刷新，请手动刷新查看结果，不会自动重新提交。" />}
        {!active && (job.status === 'FAILED' || job.errorMessage) && <Alert showIcon type="error" title="本次生成未完成" description={job.errorMessage || '暂未提供详细原因，请稍后查看任务状态。'} />}
        {retryActions.length > 0 && <Space className="outfit-history-retry" wrap>{retryActions.map(action => <Button key={action} disabled={props.retryDisabled} onClick={() => props.onRetry(job, action === 'RETRY_IMAGE' ? 'IMAGE_ONLY' : 'FULL')}>{action === 'RETRY_IMAGE' ? '重试效果图' : '重新尝试'}</Button>)}</Space>}
        {expanded && <div className="outfit-history-detail" id={`outfit-history-result-${job.taskId}`}>
          {stale && <Alert type="warning" showIcon title="对应修改前的搭配" description="这份结果保留了当时的组合，不代表当前搭配。" />}
          {job.outputFileId && <div className="outfit-history-full-image"><PrivateImage hideRefresh accountId={accountId} fileId={job.outputFileId} alt="本次搭配效果图" /></div>}
          {job.result && <div className="outfit-history-advice">
            {job.result.designReason && <section><Typography.Title level={5}>搭配思路</Typography.Title><Typography.Paragraph>{job.result.designReason}</Typography.Paragraph></section>}
            {job.result.colorAdvice && <section><Typography.Title level={5}>配色建议</Typography.Title><Typography.Paragraph>{job.result.colorAdvice}</Typography.Paragraph></section>}
            {job.result.wearingAdvice && <section><Typography.Title level={5}>穿法建议</Typography.Title><Typography.Paragraph>{job.result.wearingAdvice}</Typography.Paragraph></section>}
            {job.result.items.length > 0 && <section><Typography.Title level={5}>单品穿法</Typography.Title>{job.result.items.map((item, i) => <Typography.Paragraph key={`${item.dressId}-${i}`}><strong>{item.dressName}</strong>：{item.wearingMethod || item.matchReason}</Typography.Paragraph>)}</section>}
            {job.result.notices?.map((notice, i) => <Alert key={`${notice.code}-${i}`} type={notice.severity === 'WARNING' ? 'warning' : 'info'} title={notice.message} />)}
            {job.result.illustrativeShoes && <Alert type="info" title="鞋子为 AI 生成示意，非衣橱单品" description={job.result.illustrativeShoes.description} />}
          </div>}
        </div>}
      </article>;
    })}</div>
  </Drawer>;
}
