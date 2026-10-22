import { usePageState } from '../../app/navigation';
import { useState } from 'react';
import { Alert, Button, Empty, Form, Input, Modal, Pagination, Popconfirm, Skeleton, Space, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { ApiError, request } from '../../api/client';
import { QueryFailure } from '../workspace/TaskViews';
import { useCollections, useRecordWrite, usePageBounds, type Collection, type Favorite } from './queries';

export function CollectionManager({ accountId, selectedId, onSelect, favorite }: {
  accountId: string; selectedId?: string; onSelect?: (id: string, name: string) => void; favorite?: Favorite;
}) {
  const [page, setPage] = usePageState(`${accountId}:collections`, 'page', 1);
  const query = useCollections(accountId, page);
  const mutation = useRecordWrite(accountId);
  usePageBounds(query.data?.total, 10, query.isSuccess && !query.isFetching, setPage);
  const [editor, setEditor] = useState<Collection | 'new' | null>(null);
  const [name, setName] = useState('');
  const [validation, setValidation] = useState('');
  const [refreshed, setRefreshed] = useState(false);
  const versionRefresh = useMutation({
    retry: false,
    mutationFn: (id: string) => request<Collection>(`/collections/${encodeURIComponent(id)}`),
    onSuccess: current => { setEditor(current); setRefreshed(true); },
  });
  const busy = mutation.isPending || versionRefresh.isPending;
  const start = (value: Collection | 'new') => { mutation.reset(); versionRefresh.reset(); setValidation(''); setRefreshed(false); setEditor(value); setName(value === 'new' ? '' : value.name); };
  const save = () => {
    if (busy || !editor) return;
    const normalizedName = name.replace(/^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/gu, '').normalize('NFC');
    if (!normalizedName || Array.from(normalizedName).length > 64) { setValidation('请输入 1–64 个字符的收藏夹名称'); return; }
    setValidation('');
    mutation.mutate({ path: editor === 'new' ? '/collections' : `/collections/${editor!.id}`, method: editor === 'new' ? 'POST' : 'PATCH', body: editor === 'new' ? { name } : { name, version: editor!.version } }, { onSuccess: value => {
      if (editor && editor !== 'new' && selectedId === editor.id) {
        const updated = value as Collection;
        onSelect?.(updated.id, updated.name);
      }
      setEditor(null);
    } });
  };
  const refreshVersion = () => {
    if (editor && editor !== 'new' && !busy) {
      setRefreshed(false);
      versionRefresh.mutate(editor.id);
    }
  };
  const conflict = mutation.error instanceof ApiError && mutation.error.detail.code === 'VERSION_CONFLICT';
  return <div className="collections-manager">
    <div className="collection-heading"><Typography.Text strong>{favorite ? '加入收藏夹' : '我的收藏夹'}</Typography.Text><Button onClick={() => start('new')}>新建收藏夹</Button></div>
    {favorite ? <Typography.Paragraph type="secondary">可加入多个收藏夹。每次操作立即保存，翻页查看更多收藏夹。</Typography.Paragraph> : <Button block type={!selectedId ? 'primary' : 'default'} onClick={() => onSelect?.('', '')}>全部收藏</Button>}
    {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
    {query.isPending ? <Skeleton active paragraph={{ rows: 2 }} /> : null}
    {query.data?.items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无收藏夹" /> : null}
    <div className="collection-list">{query.data?.items.map(collection => {
      const included = favorite?.collectionIds.includes(collection.id);
      return <div className="collection-row" key={collection.id}>
        {favorite ? <Typography.Text className="collection-name">{collection.name}</Typography.Text> : <Button className="collection-name" type={selectedId === collection.id ? 'primary' : 'text'} onClick={() => onSelect?.(collection.id, collection.name)}>{collection.name}</Button>}
        <Space wrap>{favorite ? <Button loading={mutation.isPending} onClick={() => mutation.mutate({ path: `/collections/${collection.id}/items/${favorite.id}`, method: included ? 'DELETE' : 'PUT' })}>{included ? '移出此夹' : '加入此夹'}</Button> : <>
          <Button size="small" onClick={() => start(collection)}>重命名</Button>
          <Popconfirm title={`删除收藏夹“${collection.name}”？`} description="仅删除收藏夹与归属关系，收藏和设计方案仍会保留。" okText="删除" cancelText="取消" onConfirm={() => mutation.mutate({ path: `/collections/${collection.id}`, method: 'DELETE' }, { onSuccess: () => { if (selectedId === collection.id) onSelect?.('', ''); } })}><Button size="small" danger disabled={mutation.isPending}>删除</Button></Popconfirm>
        </>}</Space>
      </div>;
    })}</div>
    {query.data ? <Pagination size="small" current={page} pageSize={10} total={query.data.total} onChange={setPage} showSizeChanger={false} showTotal={n => `共 ${n} 个收藏夹`} /> : null}
    {!editor && mutation.isError ? <Alert type="error" showIcon title={mutation.error.message} /> : null}
    <Modal title={editor === 'new' ? '新建收藏夹' : '重命名收藏夹'} open={editor !== null} onCancel={() => { if (!busy) setEditor(null); }} onOk={save} okButtonProps={{ disabled: busy }} cancelButtonProps={{ disabled: busy }} confirmLoading={mutation.isPending} okText="保存" cancelText="取消" destroyOnHidden>
      <Form layout="vertical" onFinish={save}><Form.Item label="收藏夹名称" htmlFor="collection-name" validateStatus={validation ? 'error' : undefined} help={validation || '最多 64 个字符'}><Input id="collection-name" disabled={busy} value={name} onChange={e => setName(e.target.value)} autoFocus /></Form.Item></Form>
      {mutation.isError ? <Alert type="error" showIcon title={mutation.error.message} description={conflict ? '名称已被其他操作修改。刷新服务器版本后，检查当前名称，再决定是否提交你的输入。' : '输入已保留，请修改后重试。'} /> : null}
      {conflict ? <Button loading={versionRefresh.isPending} disabled={mutation.isPending} onClick={refreshVersion}>刷新服务器版本</Button> : null}
      {versionRefresh.isError ? <Alert type="error" showIcon title="无法刷新服务器版本" description={`${versionRefresh.error.message}。你的输入已保留，可重试或关闭编辑。`} /> : null}
      {refreshed && editor && editor !== 'new' ? <Typography.Paragraph>服务器当前名称：{editor.name}。你的输入已保留，请确认后再次保存。</Typography.Paragraph> : null}
    </Modal>
  </div>;
}
