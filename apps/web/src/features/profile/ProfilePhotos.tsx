import { usePageState } from '../../app/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Form, Modal, Pagination, Popconfirm, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { QueryFailure } from '../workspace/TaskViews';
import { ImageUpload, usableImage, type ImageDraft } from '../wardrobe/ImageUpload';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { photoTypes, usePhotos, useProfileEditor, type Profile } from './queries';
import type { ProfileSession } from './useProfileSession';
const { Paragraph } = Typography;
export function ProfilePhotos({ profile, session, onDirty }: { profile: Profile; session: ProfileSession; onDirty: (dirty: boolean) => void }) {
  const uploadEditor = useProfileEditor(profile);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [page, setPage] = usePageState(`${profile.id}:photos`, 'page', 1);
  const [filter, setFilter] = usePageState(`${profile.id}:photos`, 'filter', '');
  const [type, setType] = useState('PORTRAIT');
  const [items, setItems] = useState<ImageDraft[]>([]);
  useEffect(() => { onDirty(items.length > 0); }, [items, onDirty]);
  const latestItems = useRef(items);
  const savingPhoto = useRef(false);
  useEffect(() => { latestItems.current = items; }, [items]);
  const query = usePhotos(profile.id, page, filter);
  useEffect(() => { if (query.data && !query.isPlaceholderData && !query.isFetching) { const last = Math.max(1, Math.ceil(query.data.total / 12)); if (page > last) setPage(last); } }, [query.data, query.isPlaceholderData, query.isFetching, page]);
  const blocked = session.blocked || uploadEditor.busy;
  const uploadBusy = session.blocked || uploadEditor.busy;
  function savePhoto(item: ImageDraft) {
    if (!usableImage(item) || uploadBusy || savingPhoto.current) return;
    savingPhoto.current = true;
    uploadEditor.mutation.mutate({ path: '/photos', method: 'POST', versioned: false, body: { fileId: item.fileId, photoType: type } }, {
      onSuccess: () => {
        setItems(current => current.filter(value => value.key !== item.key));
        setPage(1);
        if (filter && filter !== type) setFilter(type);
        if (latestItems.current.every(value => value.key === item.key)) setUploadOpen(false);
      },
      onSettled: () => { savingPhoto.current = false; },
    });
  }
  return <div>
    {!uploadOpen && uploadEditor.mutation.isSuccess ? <Alert className="form-alert" type="success" showIcon title="照片已保存" /> : null}
    <div className="profile-photo-toolbar"><Select aria-label="筛选照片类型" style={{ width: 180 }} options={[{ value: '', label: '全部照片' }, ...photoTypes]} value={filter} onChange={v => { setFilter(v); setPage(1); }} /><Space wrap>{profile.defaultPortraitId ? <Button disabled={blocked} onClick={() => session.save({ path: '/profile/default-photos', method: 'PUT', body: { portraitId: null } })}>清除默认头像</Button> : null}{profile.defaultFullBodyId ? <Button disabled={blocked} onClick={() => session.save({ path: '/profile/default-photos', method: 'PUT', body: { fullBodyId: null } })}>清除默认全身照</Button> : null}<Button type="primary" disabled={uploadBusy} onClick={() => { if (uploadEditor.mutation.isSuccess) uploadEditor.mutation.reset(); setUploadOpen(true); }}>添加个人照片</Button></Space></div>
    <Modal open={uploadOpen} title="添加个人照片" width={720} forceRender destroyOnHidden={false} closable={!uploadBusy} keyboard={!uploadBusy} mask={{ closable: !uploadBusy }} onCancel={() => { if (!uploadBusy) setUploadOpen(false); }} footer={<Button disabled={uploadBusy} onClick={() => setUploadOpen(false)}>关闭</Button>}>
      <Paragraph type="secondary">先选择照片类型，上传并核验后保存。保存照片不会自动设为默认。关闭弹窗后，本页未保存的照片会保留。</Paragraph>
      <>{uploadEditor.mutation.isError && <Alert type="error" title={uploadEditor.mutation.error.message} />}{uploadEditor.mutation.isSuccess && <Alert type="success" title="照片已保存" />}</>
      <Form layout="vertical"><Form.Item label="照片类型" htmlFor="profile-photo-type"><Select id="profile-photo-type" style={{ width: 200 }} options={photoTypes} value={type} onChange={setType} disabled={uploadBusy} /></Form.Item></Form>
      <ImageUpload accountId={profile.id} items={items} setItems={setItems} disabled={uploadBusy} mode="photo" />
      {items.map(item => <Button className="profile-save-photo" key={item.key} type="primary" disabled={!usableImage(item) || uploadBusy} loading={uploadEditor.mutation.isPending && uploadEditor.mutation.variables?.body?.fileId === item.fileId} onClick={() => savePhoto(item)}>保存「{item.name}」为{photoTypes.find(value => value.value === type)?.label}</Button>)}
    </Modal>
    {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}{query.isPending ? <Skeleton active /> : query.data?.items.length ? <div className="profile-photo-grid">{query.data.items.map(photo => <Card key={photo.id} size="small"><PrivateImage accountId={profile.id} fileId={photo.fileId} alt={photoTypes.find(v => v.value === photo.photoType)?.label ?? '个人照片'} /><Space wrap className="form-alert"><Tag>{photoTypes.find(v => v.value === photo.photoType)?.label}</Tag>{[profile.defaultPortraitId, profile.defaultFullBodyId].includes(photo.id) ? <Tag color="green">默认</Tag> : null}</Space><Space wrap>{photo.photoType !== 'REFERENCE' ? <Button size="small" disabled={blocked || [profile.defaultPortraitId, profile.defaultFullBodyId].includes(photo.id)} onClick={() => session.save({ path: '/profile/default-photos', method: 'PUT', body: { [photo.photoType === 'PORTRAIT' ? 'portraitId' : 'fullBodyId']: photo.id } })}>设为默认{photo.photoType === 'PORTRAIT' ? '头像' : '全身照'}</Button> : null}<Popconfirm title="删除这张照片？" description="匹配的默认照片会清除，已有设计使用的图片仍会保留。" onConfirm={() => session.save({ path: `/photos/${photo.id}`, method: 'DELETE' }, () => { if (query.data?.items.length === 1 && page > 1) setPage(page - 1); })}><Button size="small" danger disabled={blocked}>删除</Button></Popconfirm></Space></Card>)}</div> : query.data ? <Empty description="还没有这一类照片，点击“添加个人照片”上传" /> : null}<Pagination className="profile-pagination" current={page} pageSize={12} total={query.data?.total ?? 0} showSizeChanger={false} onChange={setPage} /></div>;
}
