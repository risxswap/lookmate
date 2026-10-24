import { useEffect, useState } from 'react';
import { Button, Dropdown, Empty, Image, Modal, Pagination, Segmented, Skeleton, Tag, Typography } from 'antd';
import { Feedback } from '../../components/Feedback';
import { usePageState } from '../../app/navigation';
import { QueryFailure } from '../workspace/TaskViews';
import { ImageUpload, type ImageDraft } from '../wardrobe/ImageUpload';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { photoTypes, usePhotos, type Profile } from './queries';
import type { ProfileSession } from './useProfileSession';
import { usePhotoLibrary } from './usePhotoLibrary';
import './ProfilePhotos.css';

const typeLabel = (type?: string) => photoTypes.find(value => value.value === type)?.label ?? '照片';
export function ProfilePhotos({ profile, session, onDirty, onBusy }: { profile: Profile; session: ProfileSession; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [page, setPage] = usePageState(`${profile.id}:photos`, 'page', 1);
  const [filter, setFilter] = usePageState(`${profile.id}:photos`, 'filter', '');
  const [type, setType] = useState('PORTRAIT');
  const [items, setItems] = useState<ImageDraft[]>([]);
  const [modal, holder] = Modal.useModal();
  const library = usePhotoLibrary(profile.id, items, setItems, savedType => { setPage(1); if (filter && filter !== savedType) setFilter(''); });
  const busy = items.some(item => ['SENDING', 'COMPLETING'].includes(item.status) || item.libraryStatus === 'SAVING');
  const pending = items.filter(item => item.libraryStatus !== 'SAVED').length;
  useEffect(() => { onDirty(pending > 0); }, [pending, onDirty]);
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  const query = usePhotos(profile.id, page, filter);
  useEffect(() => { if (query.data && !query.isPlaceholderData && !query.isFetching) { const last = Math.max(1, Math.ceil(query.data.total / 12)); if (page > last) setPage(last); } }, [query.data, query.isPlaceholderData, query.isFetching, page, setPage]);
  const blocked = session.blocked || busy;
  function closeUpload() { if (!busy) { setUploadOpen(false); setItems(current => current.filter(item => item.libraryStatus !== 'SAVED')); } }
  return <div className="photo-library">{holder}
    <div className="photo-library-toolbar"><Segmented aria-label="筛选照片类型" options={[{ value: '', label: '全部' }, ...photoTypes]} value={filter} onChange={value => { setFilter(value); setPage(1); }} /><Button type="primary" disabled={session.blocked} onClick={() => { if (filter) setType(filter); setUploadOpen(true); }}>＋ {pending ? `继续添加（${pending}）` : '添加照片'}</Button></div>
    <Typography.Paragraph type="secondary" className="photo-library-caption">留存你的照片，为下一次形象设计做好准备。</Typography.Paragraph>
    <Modal open={uploadOpen} title="添加照片" width={720} forceRender closable={!busy} keyboard={!busy} mask={{ closable: !busy }} onCancel={closeUpload} footer={<Button type="primary" disabled={busy} onClick={closeUpload}>完成</Button>}>
      <div className="photo-upload-type"><Typography.Text strong>照片类型</Typography.Text><Segmented aria-label="上传照片类型" options={photoTypes} value={type} onChange={setType} disabled={session.blocked} /></div>
      <Typography.Paragraph type="secondary">选图后自动加入照片库，不会自动设为默认。切换类型仅影响之后选择的照片。</Typography.Paragraph>
      <ImageUpload accountId={profile.id} items={items} setItems={setItems} disabled={session.blocked} mode="photo" photoType={type} renderItem={(item, retryUpload, remove) => {
        const saving = ['SENDING', 'COMPLETING'].includes(item.status) || item.libraryStatus === 'SAVING';
        const status = item.libraryStatus === 'SAVED' ? '已加入照片库' : item.libraryStatus === 'SAVING' ? '正在加入照片库…' : item.libraryStatus === 'UNKNOWN' ? '待核对' : item.libraryStatus === 'ERROR' ? '入库失败' : item.status === 'ERROR' ? '上传失败' : '正在上传…';
        return <div className="photo-upload-item"><Image src={item.previewUrl} alt={item.name} preview={false} /><div className="photo-upload-info"><Typography.Text ellipsis title={item.name}>{item.name}</Typography.Text><span>{typeLabel(item.photoType)} · <span role="status">{status}</span></span></div><div className="photo-upload-actions">
          {uploadOpen && (item.error || item.libraryError) && <Feedback type="error" eventKey={`${item.error ?? ''}:${item.libraryError ?? ''}`} title={`${item.name}：${item.libraryError ?? item.error}`} />}
          {item.libraryStatus === 'ERROR' || item.libraryStatus === 'UNKNOWN' ? <Button size="small" disabled={session.blocked} onClick={() => library.retry(item)}>{item.libraryStatus === 'UNKNOWN' ? '核对入库结果' : '重试入库'}</Button> : item.status === 'ERROR' ? <Button size="small" disabled={session.blocked} onClick={retryUpload}>重试上传</Button> : null}
          {!saving && item.libraryStatus !== 'SAVED' && <Button size="small" type="text" disabled={session.blocked} onClick={() => { if (item.libraryStatus === 'UNKNOWN') modal.confirm({ title: '移除待确认项？', content: '原请求仍可能成功。移除只清除此处记录，请先核对照片库，避免重新上传造成重复。', okText: '移除记录', cancelText: '返回', onOk: remove }); else remove(); }}>移除</Button>}
          {item.libraryStatus === 'SAVED' && <Tag color="success">已添加</Tag>}
        </div></div>;
      }} />
    </Modal>
    {query.isError && <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} />}
    {query.isPending ? <Skeleton active /> : query.data?.items.length ? <div className="photo-library-grid">{query.data.items.map(photo => {
      const isDefault = [profile.defaultPortraitId, profile.defaultFullBodyId].includes(photo.id);
      const label = typeLabel(photo.photoType);
      return <article className="photo-library-card" key={photo.id}><div className="photo-library-frame"><PrivateImage accountId={profile.id} fileId={photo.fileId} alt={label} hideRefresh />{isDefault && <Tag className="photo-default-badge" color="green">默认{label}</Tag>}</div><div className="photo-library-meta"><span>{label}</span><Dropdown trigger={['click']} menu={{ items: [...(photo.photoType !== 'REFERENCE' ? [{ key: 'default', label: `${isDefault ? '取消' : '设为'}默认${label}` }] : []), { key: 'delete', label: '删除照片', danger: true }], onClick: ({ key }) => {
        if (blocked) return;
        if (key === 'default') session.save({ path: '/profile/default-photos', method: 'PUT', body: { [photo.photoType === 'PORTRAIT' ? 'portraitId' : 'fullBodyId']: isDefault ? null : photo.id } });
        else modal.confirm({ title: '删除这张照片？', content: '对应的默认照片会清除，已有设计使用的图片仍会保留。', okText: '删除照片', okButtonProps: { danger: true }, cancelText: '取消', onOk: () => { session.save({ path: `/photos/${photo.id}`, method: 'DELETE' }); } });
      } }}><Button type="text" className="photo-more" aria-label={`${label}更多操作`} disabled={blocked}>•••</Button></Dropdown></div></article>;
    })}</div> : query.data ? <Empty className="photo-library-empty" description={filter ? `还没有${typeLabel(filter)}` : '添加你的第一张照片，用于后续形象设计'} /> : null}
    <Pagination className="profile-pagination" current={page} pageSize={12} total={query.data?.total ?? 0} hideOnSinglePage showSizeChanger={false} onChange={setPage} />
  </div>;
}
