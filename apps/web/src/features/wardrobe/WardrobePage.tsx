import { PageHeading } from '../../components/PageHeading';
import { replaceTab, useLocation, usePageState } from '../../app/navigation';
import { OutfitsList } from '../outfits/OutfitsList';
import { useState, type ReactNode } from 'react';
import { Button, Card, Dropdown, Empty, Modal, Pagination, Radio, Skeleton, Tabs, Typography } from 'antd';
import { Feedback } from '../../components/Feedback';
import { QueryFailure } from '../workspace/TaskViews';
import { usePageBounds } from '../designs/queries';
import { DressDetail } from './DressDetail';
import { DressEditor } from './DressEditor';
import { DressEditorLoader } from './DressEditorLoader';
import { DressPreview } from './DressPreview';
import { PrivateImage } from './PrivateImage';
import { recognitionLabels, useCategories, useDresses, useWardrobeWrite, type Dress } from './queries';
import './WardrobePage.css';

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
  const [editingId, setEditingId] = useState<string>();
  const [preview, setPreview] = useState<Dress>();
  const [deleting, setDeleting] = useState<Dress>();
  const categories = useCategories(accountId);
  const query = useDresses(accountId, page, categoryId);
  const write = useWardrobeWrite(accountId);
  usePageBounds(query.data?.total, 20, query.isSuccess && !query.isFetching, setPage);
  return <><PageHeading title="熟悉的单品，新的搭配" description="整理你的衣物与饰品，为每一次设计提供灵感。" />{renderContent(<>
    {categories.isError ? <QueryFailure error={categories.error} stale={!!categories.data} loading={categories.isFetching} retry={() => void categories.refetch()} /> : null}
    <div className="wardrobe-filter wardrobe-toolbar"><Radio.Group aria-label="单品分类" value={categoryId} onChange={e => { setCategoryId(e.target.value); setPage(1); }} optionType="button" buttonStyle="solid" options={[{ value: '', label: '全部单品' }, ...(categories.data ?? []).map(c => ({ value: c.id, label: c.name }))]} /><Button type="primary" disabled={!categories.data?.length} onClick={() => setCreating(true)}>＋ 添加单品</Button></div>
    {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
    {query.isPending ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
    {query.data?.items.length === 0 ? <div className="blank-state"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={categoryId ? '这个分类还没有单品' : '添加第一件单品，开始整理你的衣橱'} /></div> : null}
    <div className="wardrobe-item-grid">{query.data?.items.map(dress => <article key={dress.id} className="wardrobe-item">
      <div className="wardrobe-item-frame">{dress.images[0] ? <PrivateImage accountId={accountId} fileId={dress.images[0].fileId} alt={`${dress.name}封面`} thumbnail hideRefresh onOpen={() => setPreview(dress)} /> : <div className="private-image"><Typography.Text type="secondary">暂无图片</Typography.Text></div>}{dress.images.length > 1 ? <span className="wardrobe-image-count">{dress.images.length} 张</span> : null}</div>
      <div className="wardrobe-item-heading"><Button type="text" className="wardrobe-item-name" title={dress.name} onClick={() => setSelectedId(dress.id)}>{dress.name}</Button><Dropdown trigger={['click']} menu={{ items: [{ key: 'detail', label: '查看详情' }, { key: 'edit', label: '编辑单品', disabled: !categories.data?.length }, { key: 'delete', label: '删除单品', danger: true }], onClick: ({ key }) => {
        if (key === 'detail') setSelectedId(dress.id);
        else if (key === 'edit') setEditingId(dress.id);
        else { write.reset(); setDeleting(dress); }
      } }}><Button type="text" className="wardrobe-item-more" aria-label={`${dress.name}更多操作`}>•••</Button></Dropdown></div>
      <Typography.Paragraph type="secondary" className="wardrobe-item-meta">{categories.data?.find(c => c.id === dress.categoryId)?.name ?? '单品'}{dress.color ? ` · ${dress.color}` : ''}</Typography.Paragraph>
      {dress.recognition && dress.recognition.status !== 'SUCCEEDED' ? <Typography.Text className="wardrobe-recognition" type={dress.recognition.status === 'FAILED' ? 'danger' : 'secondary'}>{recognitionLabels[dress.recognition.status] ?? '识别状态待确认'}{['FAILED', 'UNKNOWN'].includes(dress.recognition.status) ? <Button type="link" size="small" onClick={() => setSelectedId(dress.id)}>{dress.recognition.status === 'UNKNOWN' ? '查看并刷新' : '查看原因'}</Button> : null}</Typography.Text> : null}
    </article>)}</div>
    {query.data ? <Pagination className="records-pagination" current={page} pageSize={20} total={query.data.total} onChange={setPage} showSizeChanger={false} hideOnSinglePage showTotal={n => `共 ${n} 件单品`} /> : null}
  </>)}
    {creating ? <DressEditor accountId={accountId} categories={categories.data ?? []} initialCategoryId={categoryId || undefined} onClose={() => setCreating(false)} /> : null}
    {selectedId ? <DressDetail key={selectedId} accountId={accountId} id={selectedId} categories={categories.data ?? []} onClose={() => setSelectedId(undefined)} /> : null}
    {editingId ? <DressEditorLoader key={editingId} accountId={accountId} id={editingId} categories={categories.data ?? []} onClose={() => setEditingId(undefined)} /> : null}
    {preview ? <DressPreview key={preview.id} accountId={accountId} dress={preview} onClose={() => setPreview(undefined)} /> : null}
    {deleting ? <Modal open title="删除这件单品？" onCancel={() => setDeleting(undefined)} onOk={() => write.mutate({ path: `/dresses/${deleting.id}`, method: 'DELETE' }, { onSuccess: () => setDeleting(undefined) })} okText="删除单品" cancelText="取消" okButtonProps={{ danger: true }} confirmLoading={write.isPending} cancelButtonProps={{ disabled: write.isPending }} closable={!write.isPending} keyboard={!write.isPending} maskClosable={false}>
      <Typography.Paragraph>将从衣橱移除“{deleting.name}”，历史设计记录仍会保留。</Typography.Paragraph>
      {write.isError ? <Feedback eventKey={write.error} type="error" title={write.error.message} description="删除未完成，请重试或取消。" /> : null}
    </Modal> : null}
  </>;
}
