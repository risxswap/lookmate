import { PageHeading } from '../../components/PageHeading';
import { replaceTab, useLocation, usePageState } from '../../app/navigation';
import { OutfitsList } from '../outfits/OutfitsList';
import { useState, type ReactNode } from 'react';
import { Button, Card, Empty, Pagination, Radio, Skeleton, Tabs, Tag, Typography } from 'antd';
import { QueryFailure } from '../workspace/TaskViews';
import { usePageBounds } from '../designs/queries';
import { DressDetail } from './DressDetail';
import { DressEditor } from './DressEditor';
import { PrivateImage } from './PrivateImage';
import { recognitionLabels, useCategories, useDresses } from './queries';
export function WardrobePage({ accountId }: { accountId: string }) {
  const url = useLocation();
  const tab = url.searchParams.get('tab') === 'outfits' ? 'outfits' : 'items';
  const renderContent = (content: ReactNode) => <Card><Tabs activeKey={tab} onChange={replaceTab} items={[
    { key: 'items', label: '单品', children: tab === 'items' ? content : null },
    { key: 'outfits', label: '常用搭配', children: tab === 'outfits' ? content : null },
  ]} /></Card>;
  return tab === 'outfits' ? <OutfitsList accountId={accountId} renderContent={renderContent} /> : <WardrobeItems accountId={accountId} renderContent={renderContent} />;
}
function WardrobeItems({ accountId, renderContent }: { accountId: string; renderContent: (content: ReactNode) => ReactNode }) {
  const [categoryId, setCategoryId] = usePageState(`${accountId}:wardrobe`, 'category', '');
  const [page, setPage] = usePageState(`${accountId}:wardrobe`, 'page', 1);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const categories = useCategories(accountId);
  const query = useDresses(accountId, page, categoryId);
  usePageBounds(query.data?.total, 20, query.isSuccess && !query.isFetching, setPage);
  return <><PageHeading title="熟悉的单品，新的搭配" description="整理你的衣物与饰品，为每一次设计提供灵感。" action={<Button type="primary" disabled={!categories.data?.length} onClick={() => setCreating(true)}>添加单品</Button>} />{renderContent(<>
    {categories.isError ? <QueryFailure error={categories.error} stale={!!categories.data} loading={categories.isFetching} retry={() => void categories.refetch()} /> : null}
    <div className="wardrobe-filter"><Typography.Text strong>单品分类</Typography.Text><Radio.Group aria-label="单品分类" value={categoryId} onChange={e => { setCategoryId(e.target.value); setPage(1); }} optionType="button" buttonStyle="solid" options={[{ value: '', label: '全部单品' }, ...(categories.data ?? []).map(c => ({ value: c.id, label: c.name }))]} /><Button loading={query.isFetching} onClick={() => void query.refetch()}>刷新衣橱</Button></div>
    {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
    {query.isPending ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
    {query.data?.items.length === 0 ? <div className="blank-state"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={categoryId ? '这个分类还没有单品' : '添加第一件单品，开始整理你的衣橱'}><Button type="primary" disabled={!categories.data?.length} onClick={() => setCreating(true)}>添加单品</Button></Empty></div> : null}
    <div className="dress-card-grid">{query.data?.items.map(dress => <Card key={dress.id} className="dress-card"><PrivateImage accountId={accountId} fileId={dress.images[0].fileId} alt={`${dress.name}封面`} thumbnail /><Typography.Title level={4}>{dress.name}</Typography.Title><Typography.Paragraph type="secondary">{categories.data?.find(c => c.id === dress.categoryId)?.name ?? '单品'}{dress.color ? ` · ${dress.color}` : ''}</Typography.Paragraph><Tag>{dress.recognition ? recognitionLabels[dress.recognition.status] ?? dress.recognition.status : '尚无识别任务'}</Tag><Button block onClick={() => setSelectedId(dress.id)}>查看单品</Button></Card>)}</div>
    {query.data ? <Pagination className="records-pagination" current={page} pageSize={20} total={query.data.total} onChange={setPage} showSizeChanger={false} showTotal={n => `共 ${n} 件单品`} /> : null}
  </>)}{creating ? <DressEditor accountId={accountId} categories={categories.data ?? []} onClose={() => setCreating(false)} /> : null}{selectedId ? <DressDetail key={selectedId} accountId={accountId} id={selectedId} categories={categories.data ?? []} onClose={() => setSelectedId(undefined)} /> : null}</>;
}
