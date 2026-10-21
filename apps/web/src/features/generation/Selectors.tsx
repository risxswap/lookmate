import { useState } from 'react';
import { Alert, Button, Card, Checkbox, Empty, Modal, Pagination, Select, Skeleton, Space, Typography } from 'antd';
import { useCategories, useDresses, type Dress } from '../wardrobe/queries';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { photoTypes, usePhotos } from '../profile/queries';
import { usePageBounds } from '../designs/queries';

export function PhotoPicker({ accountId, value, onSelect, onClose }: { accountId: string; value: string; onSelect: (fileId: string) => void; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const query = usePhotos(accountId, page, type);
  usePageBounds(query.data?.total, 12, query.isSuccess && !query.isFetching, setPage);
  return <Modal open title="选择本人照片" width={780} onCancel={onClose} footer={<Button onClick={onClose}>完成</Button>}>
    <Select aria-label="照片类型" value={type} onChange={v => { setType(v); setPage(1); }} options={[{ value: '', label: '全部类型' }, ...photoTypes]} />
    {query.isError ? <Alert type="error" showIcon title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : null}
    {query.isPending ? <Skeleton active /> : null}
    {query.data?.items.length === 0 ? <Empty description="还没有照片，可上传一张本人照片" /> : null}
    <div className="generation-picker-grid">{query.data?.items.map(photo => <Card size="small" key={photo.id}><PrivateImage accountId={accountId} fileId={photo.fileId} thumbnail alt={photoTypes.find(v => v.value === photo.photoType)?.label || '本人照片'} /><Button block type={photo.fileId === value ? 'primary' : 'default'} onClick={() => { onSelect(photo.fileId); onClose(); }}>{photo.fileId === value ? '已选照片' : '使用这张照片'}</Button></Card>)}</div>
    {query.data ? <Pagination current={page} pageSize={12} total={query.data.total} onChange={setPage} showSizeChanger={false} /> : null}
  </Modal>;
}
export function DressPicker({ accountId, ids, names, onChange }: { accountId: string; ids: string[]; names: Record<string, string>; onChange: (ids: string[], dress?: Dress) => void }) {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const query = useDresses(accountId, page, category);
  const categories = useCategories(accountId);
  usePageBounds(query.data?.total, 20, query.isSuccess && !query.isFetching, setPage);
  return <>
    <Typography.Paragraph type="secondary">不指定时从衣橱自动选衣。指定的单品必须实际穿用，无法搭配时会说明原因。</Typography.Paragraph>
    <Space wrap className="generation-selected">{ids.map(id => <Button key={id} size="small" onClick={() => onChange(ids.filter(v => v !== id))} aria-label={`移除必穿单品 ${names[id] || id}`}>{names[id] || `单品 ${id}`} ×</Button>)}</Space>
    <Select aria-label="筛选衣物类别" value={category} onChange={v => { setCategory(v); setPage(1); }} options={[{ value: '', label: '全部类别' }, ...(categories.data || []).map(v => ({ value: v.id, label: v.name }))]} />
    {categories.isError ? <Alert type="warning" title="分类读取失败" action={<Button onClick={() => void categories.refetch()}>重试分类</Button>} /> : null}
    {query.isError ? <Alert type="error" showIcon title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试衣橱</Button>} /> : null}
    {query.isPending ? <Skeleton active /> : null}
    {query.data?.items.length === 0 ? <Empty description="没有可选单品"><Button href="/app/wardrobe">补充我的衣橱</Button></Empty> : null}
    <div className="generation-picker-grid">{query.data?.items.map(dress => <Card size="small" key={dress.id}>
      {dress.images[0] ? <PrivateImage accountId={accountId} fileId={dress.images[0].fileId} thumbnail alt={dress.name} /> : null}
      <Checkbox checked={ids.includes(dress.id)} onChange={e => onChange(e.target.checked ? [...ids, dress.id] : ids.filter(id => id !== dress.id), dress)}>{dress.name}</Checkbox>
    </Card>)}</div>
    {query.data ? <Pagination current={page} pageSize={20} total={query.data.total} onChange={setPage} showSizeChanger={false} showTotal={n => `共 ${n} 件`} /> : null}
  </>;
}
