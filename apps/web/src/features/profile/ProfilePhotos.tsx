import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Dropdown, Empty, Image, Modal, Pagination, Skeleton, Typography } from 'antd';
import { request } from '../../api/client';
import { Feedback } from '../../components/Feedback';
import { QueryFailure } from '../workspace/TaskViews';
import { ImageUpload, type ImageDraft } from '../wardrobe/ImageUpload';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { usePhotos, photoAngles, type PhotoAngle, type Photo, type Profile } from './queries';
import type { ProfileSession } from './useProfileSession';
import { usePhotoSlotUpload } from './usePhotoSlotUpload';
import './ProfilePhotos.css';

type Slot = 'PORTRAIT' | 'FULL_BODY' | 'SUPPLEMENT';
interface PhotoSlots { version: string; portrait: Photo | null; fullBody: Photo | null; supplements: Photo[]; supplementTotal: number; total: number; angles: Partial<Record<PhotoAngle, Photo | null>> }
interface Target { slot: Slot; photo?: Photo; label: string; angle?: PhotoAngle }

export function ProfilePhotos({ profile, session, onDirty, onBusy, children }: { children: ReactNode; profile: Profile; session: ProfileSession; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void }) {
  const query = useQuery({ queryKey: ['photos', profile.id, 'slots', profile.version], queryFn: ({ signal }) => request<PhotoSlots>('/photos/slots', { signal }) });
  const [target, setTarget] = useState<Target | null>(null);
  const [items, setItems] = useState<ImageDraft[]>([]);
  const [organize, setOrganize] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null);
  const [modal, holder] = Modal.useModal();
  const uploading = items.some(item => ['SENDING', 'COMPLETING'].includes(item.status));
  const data = query.data;
  const stale = !!data && data.version !== profile.version;
  const blocked = session.blocked || uploading || stale;
  const { attempted, saved, uncertain, persist, reset } = usePhotoSlotUpload(target, items, session, blocked, data);
  const pending = items.length > 0 && !saved;
  useEffect(() => { onDirty(pending); }, [pending, onDirty]);
  useEffect(() => { onBusy(uploading); }, [uploading, onBusy]);
  function open(next: Target) {
    setTarget(next); setItems([]); reset();
  }
  function close() {
    if (uploading || session.busy) return;
    if (pending) modal.confirm({ title: '关闭照片上传？', content: uncertain ? '保存结果尚未确认，请先通过页面上的资料核对操作检查结果。关闭只清除此处上传记录，不会撤销已成功的保存。' : '当前照片尚未保存，关闭将清除此处上传记录。', okText: '关闭', cancelText: '继续处理', onOk: () => { setTarget(null); setItems([]); } });
    else { setTarget(null); setItems([]); }
  }
  function remove(photo: Photo) {
    modal.confirm({ title: '删除这张照片？', content: '已有设计使用的图片仍会保留。', okText: '删除照片', okButtonProps: { danger: true }, cancelText: '取消', onOk: () => session.save({ path: `/photos/${photo.id}`, method: 'DELETE', scope: 'photos' }) });
  }
  const capacityReached = !!data && (data.total >= 6 || data.supplementTotal >= 4);
  const needsReplacement = !!target && target.slot === 'SUPPLEMENT' && !target.photo && capacityReached;
  const latestTargetPhoto = target?.angle ? data?.angles?.[target.angle] : target?.slot === 'PORTRAIT' ? data?.portrait : data?.fullBody;
  const canChooseAgain = !session.blocked && !stale && !uploading && !uncertain && (!saved || latestTargetPhoto?.fileId === items[0]?.fileId);
  function prepareReplacement() {
    if (saved && latestTargetPhoto) setTarget(current => current ? { ...current, photo: latestTargetPhoto } : null);
    reset();
  }
  function tile(slot: Slot, label: string, photo?: Photo | null, angle?: PhotoAngle) {
    const small = slot === 'SUPPLEMENT';
    return <article className={`profile-photo-slot profile-photo-slot-${slot.toLowerCase()}${angle ? ` profile-photo-angle-${angle.toLowerCase()}` : ''}${slot === 'FULL_BODY' || angle === 'BACK_BODY' ? ' profile-photo-main-body' : ''}`} key={photo?.id ?? label}>
      <h3 className="profile-photo-label">{label}{small && <span>选填</span>}</h3>
      <div className="profile-photo-frame">
        {photo ? <><PrivateImage accountId={profile.id} fileId={photo.fileId} alt={label} hideRefresh preview={{ open: previewPhoto?.id === photo.id, onOpenChange: open => setPreviewPhoto(open ? photo : null) }} /><Button type="text" className="profile-photo-replace" aria-label={`更换${label}`} disabled={blocked} onClick={() => open({ slot, photo, label, angle })}><span>点击更换照片</span></Button></> : <Button className="profile-photo-empty" aria-label={`上传${label}`} disabled={blocked || !data} onClick={() => open({ slot, label, angle })}><span aria-hidden>＋</span><span>上传照片</span></Button>}
        {photo && <Dropdown trigger={['click']} disabled={blocked} menu={{ items: [{ key: 'preview', label: '查看大图' }, { key: 'replace', label: '更换照片' }, { key: 'delete', label: '删除照片', danger: true }], onClick: ({ key }) => {
          if (blocked) return;
          if (key === 'preview') setPreviewPhoto(photo);
          if (key === 'replace') open({ slot, photo, label, angle });
          if (key === 'delete') remove(photo);
        } }}><Button className="profile-photo-more" aria-label={`${label}更多操作`} disabled={blocked}>···</Button></Dropdown>}
      </div>
    </article>;
  }
  const angleTile = (angle: PhotoAngle) => tile('SUPPLEMENT', photoAngles.find(item => item.value === angle)!.label, data?.angles?.[angle], angle);
  const unclassified = data ? data.supplementTotal - Object.values(data.angles ?? {}).filter(Boolean).length : 0;
  return <div className="profile-photos">{holder}
    {query.isError && <QueryFailure error={query.error} stale={!!data} loading={query.isFetching} retry={() => void query.refetch()} />}
    {stale && <Feedback type="warning" title="照片资料已更新，请刷新基础资料并核对后继续。" />}
    <section className="profile-personal-block" aria-labelledby="profile-basic-heading">
      <div className="profile-photos-heading"><h2 id="profile-basic-heading">基本信息</h2></div>
      <div className="profile-personal-section">
        {children}
        <div className="profile-portrait">{query.isPending ? <Skeleton.Image active /> : tile('PORTRAIT', '正面头像', data?.portrait)}</div>
      </div>
    </section>
    <section className="profile-body-section" id="profile-photos">
      <div className="profile-photos-heading"><h2>全身照片</h2>{data && data.total > 0 && <Button type="link" onClick={() => setOrganize(true)}>整理照片</Button>}</div>
      {query.isPending ? <Skeleton active /> : data ? <>
        <div className="profile-photo-composition">
          <div className="profile-photo-side profile-photo-side-left">{angleTile('SIDE_FACE')}{angleTile('SIDE_BODY')}</div>
          <div className="profile-photo-body-pair">{tile('FULL_BODY', '正面全身照', data.fullBody)}{angleTile('BACK_BODY')}</div>
          <div className="profile-photo-side profile-photo-side-right">{angleTile('BACK_HEAD')}</div>
        </div>
        {unclassified > 0 && <p className="profile-photo-overflow">还有 {unclassified} 张照片未指定角度，可在“整理照片”中选择归位。</p>}
        {data.total >= 6 && (!data.portrait || !data.fullBody) && <p className="profile-photo-overflow">照片数量已达上限，请先整理旧照片，再上传主要照片。</p>}
      </> : null}
    </section>
    <Modal open={!!target} title={`${target?.photo ? '更换' : '上传'}${target?.label ?? '照片'}`} width={580} forceRender closable={!uploading && !session.busy} mask={{ closable: !uploading && !session.busy }} onCancel={close} footer={<Button type="primary" disabled={uploading || session.busy} onClick={close}>{saved ? '完成' : '关闭'}</Button>}>
      {needsReplacement ? <PhotoReplacementPicker profile={profile} label={target?.label ?? '照片'} blocked={blocked} onSelect={photo => setTarget(current => current ? { ...current, photo } : null)} onOrganize={() => { setTarget(null); setOrganize(true); }} /> : <>
      {target?.photo && !target.photo.angle && target.slot === 'SUPPLEMENT' && <p>新照片保存成功后将替换所选未分类照片；失败时原照片保留。</p>}
      <Typography.Paragraph type="secondary">选择一张照片后自动保存。点击已选图片可重新上传。</Typography.Paragraph>
      <ImageUpload accountId={profile.id} mode="photo" maxFiles={1} items={items} setItems={setItems} replaceSingle onReplaceSelected={prepareReplacement} disabled={!canChooseAgain} renderItem={(item, retryUpload, discard, replace) => <div className="photo-upload-item"><Button type="text" className="photo-upload-reselect" aria-label="重新选择照片" disabled={!canChooseAgain} onClick={replace}><Image src={item.previewUrl} alt={item.name} preview={false} /></Button><div className="photo-upload-info"><span>{item.name}</span><span role="status">{saved ? '照片已保存' : session.busy && attempted ? '正在保存照片…' : uploading ? '正在上传…' : uncertain ? '保存结果待核对' : item.status === 'ERROR' ? '上传失败' : attempted ? '照片尚未保存' : '正在准备保存…'}</span>{item.error && <span>{item.error}</span>}</div>{item.status === 'ERROR' && <Button disabled={session.blocked} onClick={retryUpload}>重试上传</Button>}{!attempted && !uploading && <Button onClick={discard}>移除</Button>}</div>} />
      {attempted && !saved && session.error && <Feedback type="warning" title={session.error} />}
      {attempted && !saved && !uncertain && !session.blocked && <Button onClick={persist}>重试保存照片</Button>}
      {uncertain && !saved && <p>请关闭弹窗，通过页面上的“读取最新资料并核对”确认结果，避免重复添加。</p>}
      </>}
    </Modal>
    {organize && <PhotoOrganizer profile={profile} session={session} slots={data} blocked={blocked} remove={remove} onClose={() => setOrganize(false)} />}
  </div>;
}

function PhotoOrganizer({ profile, session, slots, blocked, remove, onClose }: { slots?: PhotoSlots; blocked: boolean; profile: Profile; session: ProfileSession; remove: (photo: Photo) => void; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const query = usePhotos(profile.id, page, '');
  useEffect(() => { if (query.data && !query.isFetching) setPage(current => Math.min(current, Math.max(1, Math.ceil(query.data!.total / 12)))); }, [query.data, query.isFetching]);
  return <Modal open title="整理照片" width={800} onCancel={onClose} footer={<Button onClick={onClose}>完成</Button>}>
    <p>为未分类照片选择对应角度。已占用的角度请在主页面更换，删除不会影响已有设计。</p>
    {session.error && <Feedback type="warning" title={session.error} />}
    {query.isError && <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} />}
    {query.isPending ? <Skeleton active /> : query.data?.items.length ? <div className="profile-organizer-grid">{query.data.items.map(photo => <article key={photo.id}><PrivateImage accountId={profile.id} fileId={photo.fileId} alt="个人照片" hideRefresh /><div><span>{photo.id === profile.defaultPortraitId ? '主要头像照' : photo.id === profile.defaultFullBodyId ? '主要全身照' : photoAngles.find(item => item.value === photo.angle)?.label ?? '未分类'}</span><Button danger type="text" disabled={blocked} onClick={() => remove(photo)}>删除</Button></div>{photo.id !== profile.defaultPortraitId && photo.id !== profile.defaultFullBodyId && <Dropdown trigger={['click']} disabled={blocked || !slots} menu={{ items: photoAngles.map(angle => ({ key: angle.value, label: angle.label, disabled: !!slots?.angles?.[angle.value] })), onClick: ({ key }) => { if (!blocked) void session.save({ path: `/photos/${photo.id}/angle`, method: 'PATCH', scope: 'photos', body: { angle: key } }); } }}><Button block disabled={blocked || !slots || photoAngles.every(angle => !!slots.angles?.[angle.value])}>{photo.angle ? '调整角度' : '指定角度'}</Button></Dropdown>}</article>)}</div> : <Empty description="还没有照片" />}
    <Pagination current={page} pageSize={12} total={query.data?.total ?? 0} hideOnSinglePage showSizeChanger={false} onChange={setPage} />
  </Modal>;
}

function PhotoReplacementPicker({ profile, label, blocked, onSelect, onOrganize }: { profile: Profile; label: string; blocked: boolean; onSelect: (photo: Photo) => void; onOrganize: () => void }) {
  const [page, setPage] = useState(1);
  const query = usePhotos(profile.id, page, '');
  const candidates = query.data?.items.filter(photo => !photo.angle && photo.id !== profile.defaultPortraitId && photo.id !== profile.defaultFullBodyId) ?? [];
  return <div>
    <p>旧照片已占满名额。请选择一张未分类照片，用新上传的{label}替换；只有新照片保存成功后才会替换原图。</p>
    {query.isError && <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} />}
    {query.isPending ? <Skeleton active /> : candidates.length ? <div className="profile-replacement-grid">{candidates.map(photo => <article key={photo.id}><PrivateImage accountId={profile.id} fileId={photo.fileId} alt="未分类照片" hideRefresh /><Button block disabled={blocked} onClick={() => onSelect(photo)}>替换这张照片</Button></article>)}</div> : <Empty description="本页没有可替换的未分类照片，可翻页查找或整理已有照片。" />}
    <Pagination current={page} pageSize={12} total={query.data?.total ?? 0} hideOnSinglePage showSizeChanger={false} onChange={setPage} />
    <Button onClick={onOrganize}>整理照片</Button>
  </div>;
}
