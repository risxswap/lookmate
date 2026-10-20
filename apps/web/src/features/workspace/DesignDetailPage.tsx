import { Alert, Button, Card, Descriptions, Empty, Result, Skeleton, Space, Typography } from 'antd';
import { FavoriteAction } from '../designs/FavoriteAction';
import { ApiError } from '../../api/client';
import { useDesignDetail } from './queries';
import { QueryFailure, StatusTag, TaskMetadata, TaskNotice } from './TaskViews';

export function DesignDetailPage({ accountId, id }: { accountId: string; id: string }) {
  const query = useDesignDetail(accountId, id);
  const task = query.data;
  const result = task?.result;
  const unavailable = query.error instanceof ApiError && query.error.status === 404;
  return <div className="design-detail">
    <div className="section-heading"><div><Typography.Title level={2}>设计详情</Typography.Title><Typography.Paragraph type="secondary">查看任务进度与已保存的方案文字。</Typography.Paragraph></div><Space><Button href="/app">返回工作台</Button><Button loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button></Space></div>
    {unavailable ? <Result status="404" title="设计记录不可用" subTitle="记录不存在或已不可访问。" extra={<Button href="/app">返回工作台</Button>} /> : <>
      {query.isError ? <QueryFailure error={query.error} stale={!!task} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
      {query.isPending ? <Card><Skeleton active title paragraph={{ rows: 5 }} /></Card> : null}
      {task ? <>
        <Card title={task.title || '设计任务'} extra={<StatusTag status={task.status} />}><TaskMetadata task={task} /><FavoriteAction accountId={accountId} task={task} /><TaskNotice task={task} /></Card>
        {result ? <>
          {task.status !== 'SUCCEEDED' ? <Alert type="info" showIcon title="以下为已保存的方案文字" description="任务尚未完整成功，已保存的文字不代表效果图生成或结果保存全部完成。" /> : null}
          <Card title={result.title}>
            <Typography.Paragraph className="task-text">{result.summary}</Typography.Paragraph>
            <Descriptions className="task-text" column={1} items={[
              { key: 'style', label: '风格', children: result.style },
              { key: 'occasion', label: '适用场合', children: result.occasion },
              { key: 'reason', label: '设计理由', children: result.designReason },
              { key: 'color', label: '配色建议', children: result.colorAdvice || '暂无建议' },
              { key: 'wearing', label: '整体穿着建议', children: result.wearingAdvice || '暂无建议' },
            ]} />
          </Card>
          {result.hairstyle ? <Card title="发型方案"><Descriptions className="task-text" column={1} items={[
            { key: 'name', label: '发型名称', children: result.hairstyle.hairstyleName },
            { key: 'length', label: '长度建议', children: result.hairstyle.lengthAdvice },
            { key: 'bangs', label: '刘海建议', children: result.hairstyle.bangsAdvice },
            { key: 'parting', label: '分缝建议', children: result.hairstyle.partingAdvice },
            { key: 'texture', label: '质感建议', children: result.hairstyle.textureAdvice },
            { key: 'color', label: '发色建议', children: result.hairstyle.hairColorAdvice },
            { key: 'care', label: '打理建议', children: result.hairstyle.careAdvice },
          ]} /></Card> : null}
          {result.items.length ? <Card title="穿搭单品"><div className="outfit-detail-list">{result.items.map((item, index) => <section key={`${item.dressId}-${index}`}><Typography.Title level={4}>{index + 1}. {item.dressName}</Typography.Title><Descriptions className="task-text" column={1} items={[
            { key: 'category', label: '分类', children: item.categoryName },
            { key: 'reason', label: '搭配理由', children: item.matchReason },
            { key: 'method', label: '穿着方式', children: item.wearingMethod },
          ]} /></section>)}</div></Card> : null}
          <Alert type="info" showIcon title="效果图暂不可查看" description="私有图片访问服务尚未接入，当前仅展示已保存的方案文字。" />
        </> : <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已保存的方案文字" /></Card>}
      </> : null}
    </>}
  </div>;
}
