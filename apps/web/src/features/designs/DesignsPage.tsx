import { useState } from 'react';
import { replaceTab, useLocation } from '../../app/navigation';
import { Button, Card, Empty, Modal, Pagination, Select, Skeleton, Space, Tabs, Typography } from 'antd';
import { TaskCard, QueryFailure } from '../workspace/TaskViews';
import { useRecords, useFavorites, usePageBounds } from './queries';
import { CollectionManager } from './CollectionManager';
function Records({ accountId }: { accountId: string }) {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const query = useRecords(accountId, page, type, status);
  usePageBounds(query.data?.total, 20, query.isSuccess && !query.isFetching, setPage);
  return <>
    <div className="filter-row"><Space wrap>
      <Select aria-label="设计模式" value={type} onChange={v => { setType(v); setPage(1); }} options={[{ value: '', label: '全部模式' }, { value: 'OVERALL', label: '整体设计' }, { value: 'HAIRSTYLE', label: '只改发型' }, { value: 'OUTFIT', label: '只改穿搭' }]} />
      <Select aria-label="设计状态" value={status} onChange={v => { setStatus(v); setPage(1); }} options={[['', '全部状态'], ['QUEUED', '等待中'], ['PLANNING', '正在规划'], ['GENERATING', '正在生成效果图'], ['SAVING', '正在保存结果'], ['SUCCEEDED', '已完成'], ['FAILED', '失败'], ['UNKNOWN', '结果待确认']].map(([value, label]) => ({ value, label }))} />
    </Space><Button loading={query.isFetching} onClick={() => void query.refetch()}>刷新记录</Button></div>
    {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
    {query.isPending ? <Skeleton active paragraph={{ rows: 5 }} /> : null}
    {query.data?.items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={type || status ? '没有符合筛选条件的记录' : page > 1 ? '这一页没有记录，请返回前一页' : '还没有设计记录'}><Button href="/app/design/new">开始形象设计</Button></Empty> : null}
    <div className="recent-task-grid">{query.data?.items.map(task => <TaskCard key={task.id} task={task} accountId={accountId} />)}</div>
    {query.data ? <Pagination className="records-pagination" current={page} pageSize={20} total={query.data.total} onChange={setPage} showSizeChanger={false} showTotal={n => `共 ${n} 条记录`} /> : null}
  </>;
}
function Favorites({ accountId }: { accountId: string }) {
  const [page, setPage] = useState(1);
  const [collection, setCollection] = useState({ id: '', name: '' });
  const [groupId, setGroupId] = useState<string | null>(null);
  const query = useFavorites(accountId, page, collection.id);
  usePageBounds(query.data?.total, 20, query.isSuccess && !query.isFetching, setPage);
  const favorite = query.data?.items.find(item => item.id === groupId);
  return <div className="records-favorites-layout">
    <aside className="folder-panel"><CollectionManager accountId={accountId} selectedId={collection.id} onSelect={(id, name) => { setCollection({ id, name }); setPage(1); setGroupId(null); }} /></aside>
    <section className="favorite-results">
      <div className="filter-row"><Typography.Text strong>{collection.name || '全部收藏'}</Typography.Text><Button loading={query.isFetching} onClick={() => void query.refetch()}>刷新收藏</Button></div>
      {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
      {query.isPending ? <Skeleton active paragraph={{ rows: 5 }} /> : null}
      {query.data?.items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={page > 1 ? '这一页没有收藏，请返回前一页' : collection.id ? '这个收藏夹还没有设计' : '还没有收藏，去全部记录中收藏喜欢的方案吧'} /> : null}
      <div className="favorite-grid">{query.data?.items.map(item => <div className="favorite-record" key={item.id}><TaskCard task={item.task} accountId={accountId} /><div className="favorite-group-action"><Typography.Text type="secondary">已加入 {item.collectionIds.length} 个收藏夹</Typography.Text><Button onClick={() => setGroupId(item.id)}>管理归属</Button></div></div>)}</div>
      {query.data ? <Pagination className="records-pagination" current={page} pageSize={20} total={query.data.total} onChange={v => { setPage(v); setGroupId(null); }} showSizeChanger={false} showTotal={n => `共 ${n} 条收藏`} /> : null}
      <Modal title="整理收藏" open={!!favorite} onCancel={() => setGroupId(null)} footer={<Button onClick={() => setGroupId(null)}>完成</Button>} destroyOnHidden>{favorite ? <CollectionManager accountId={accountId} favorite={favorite} /> : null}</Modal>
    </section>
  </div>;
}
export function DesignsPage({ accountId }: { accountId: string }) {
  const tab = useLocation().searchParams.get('tab') === 'favorites' ? 'favorites' : 'all';
  return <><div className="section-heading"><div><Typography.Title level={2}>每一次探索，都值得留下</Typography.Title><Typography.Paragraph type="secondary">回看你的设计，收藏喜欢的风格。</Typography.Paragraph></div><Button type="primary" href="/app/design/new">新建设计</Button></div>
    <Card><Tabs activeKey={tab} onChange={replaceTab} items={[{ key: 'all', label: '全部记录' }, { key: 'favorites', label: '我的收藏' }]} />{tab === 'all' ? <Records accountId={accountId} /> : <Favorites accountId={accountId} />}</Card>
  </>;
}
