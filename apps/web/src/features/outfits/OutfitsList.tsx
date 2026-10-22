import type { ReactNode } from 'react';
import { PageHeading } from '../../components/PageHeading';
import { usePageState } from '../../app/navigation';
import { Alert, Button, Card, Dropdown, Empty, Pagination, Skeleton, Space, Tag, Typography } from 'antd';
import { useOutfits, useOutfitWrite, type Outfit, type OutfitGroup } from './api';
import { GroupControl } from './Groups';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { usePageBounds } from '../designs/queries';
import './outfits.css';
export function OutfitBoard({ accountId, outfit }: { accountId: string; outfit: Outfit }) {
  if (outfit.sourceOutputFileId && outfit.revision === '0') return <div className="outfit-source-cover"><PrivateImage accountId={accountId} fileId={outfit.sourceOutputFileId} thumbnail compact alt={`${outfit.name}原设计效果图`} /></div>;
  return <div className="outfit-board" style={{ gridTemplateRows: `repeat(${Math.max(1, Math.ceil(outfit.items.length / 2))}, minmax(0, 1fr))` }}>{outfit.items.map(item => <div key={item.dressId}>{item.imageFileIds[0] ? <PrivateImage accountId={accountId} fileId={item.imageFileIds[0]} thumbnail compact alt={item.dressName} /> : <span>{item.dressName}</span>}</div>)}</div>;
}
export function OutfitsList({ accountId, dashboard = false, renderContent }: { accountId: string; dashboard?: boolean; renderContent?: (content: ReactNode) => ReactNode }) {
  const [page, setPage] = usePageState(`${accountId}:outfits`, 'page', 1); const [groups, setGroups] = usePageState<OutfitGroup[]>(`${accountId}:outfits`, 'groups', []); const size = dashboard ? 4 : 20;
  const query = useOutfits(accountId, page, groups[0]?.id || '', size); const write = useOutfitWrite(accountId);
  usePageBounds(query.data?.total, size, query.isSuccess && !query.isFetching, setPage);
  const emptyState = <Empty description={groups.length ? '这个分组还没有搭配' : '保存第一套自己常穿的搭配'}>{!dashboard ? <Button type="primary" href="/app/wardrobe/outfits/new">从衣橱组合</Button> : null}</Empty>;
  const content = <>
    <div className="outfit-filters"><GroupControl accountId={accountId} management={!dashboard} value={groups} onChange={v => { setGroups(v); setPage(1); }} />{!dashboard ? <Button loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button> : null}</div>
    {query.isError ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : null}{write.isError ? <Alert type="error" title={write.error.message} /> : null}{query.isPending ? <Skeleton active /> : null}
    {query.data?.items.length === 0 ? (dashboard || renderContent ? <div className="blank-state">{emptyState}</div> : <Card>{emptyState}</Card>) : null}
    <div className="outfits-grid">{query.data?.items.map(outfit => <Card key={outfit.id} className="outfit-card" cover={<a href={`/app/wardrobe/outfits/${outfit.id}`} aria-label={`查看搭配 ${outfit.name}`}><OutfitBoard accountId={accountId} outfit={outfit} /></a>}><div className="outfit-card-heading"><a href={`/app/wardrobe/outfits/${outfit.id}`}>{outfit.name}</a>{dashboard ? <Dropdown trigger={['click']} menu={{ items: [{ key: 'pin', label: outfit.pinned ? '取消置顶' : '置顶', disabled: write.isPending }], onClick: () => write.mutate({ path: `/outfits/${outfit.id}`, method: 'PATCH', body: { version: outfit.version, pinned: !outfit.pinned } }) }}><Button size="small" type="text" aria-label={`搭配 ${outfit.name} 的更多操作`} loading={write.isPending && write.variables?.path === `/outfits/${outfit.id}`}>···</Button></Dropdown> : <Button size="small" type="text" loading={write.isPending && write.variables?.path === `/outfits/${outfit.id}`} onClick={() => write.mutate({ path: `/outfits/${outfit.id}`, method: 'PATCH', body: { version: outfit.version, pinned: !outfit.pinned } })}>{outfit.pinned ? '取消置顶' : '置顶'}</Button>}</div><Typography.Text type="secondary">{outfit.items.length} 件单品{outfit.pinned ? ' · 已置顶' : ''}</Typography.Text><div>{outfit.groups.map(g => <Tag key={g.id}>{g.name}</Tag>)}</div>{outfit.items.some(i => i.missing) ? <Tag color="orange">有缺失单品</Tag> : null}</Card>)}</div>
    {query.data && (!dashboard || query.data.total > size) ? <Pagination className="records-pagination" current={page} pageSize={size} total={query.data.total} showSizeChanger={false} onChange={setPage} /> : null}
  </>;
  if (dashboard) return <section className="outfits-section outfits-dashboard">
    <Card title="我的常用搭配" extra={<Space><Button href="/app/wardrobe/outfits/new">＋组合搭配</Button><Button href="/app/wardrobe?tab=outfits">查看全部</Button><Button type="primary" href="/app/design/new">开始形象设计 ↗</Button></Space>}>
      {content}
    </Card>
  </section>;
  return <section className="outfits-section"><PageHeading title="常用搭配" description="把穿得顺手的组合留下来，置顶的搭配优先展示。" action={<Button type="primary" href="/app/wardrobe/outfits/new">＋组合搭配</Button>} />
    {renderContent ? renderContent(content) : content}
  </section>;
}
