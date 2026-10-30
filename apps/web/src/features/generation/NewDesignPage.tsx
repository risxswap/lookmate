import { Feedback } from '../../components/Feedback';
import { PageHeading } from '../../components/PageHeading';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Collapse, Drawer, Form, Input, Modal, Radio, Skeleton, Space, Typography } from 'antd';
import { ApiError, request } from '../../api/client';
import { navigate, useLocation } from '../../app/navigation';
import { useProfile, type Photo, type Profile } from '../profile/queries';
import { ImageUpload, usableImage, type ImageDraft } from '../wardrobe/ImageUpload';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { QueryFailure, designTypeName } from '../workspace/TaskViews';
import type { DesignDetail } from '../workspace/queries';
import { dictionaries } from '../profile/preferences';
import { useDesignPreview } from './useDesignPreview';
import { PreviewDetails } from './PreviewDetails';
import { HairstyleStudio } from './HairstyleStudio';
import { completeHairSubmission, hairEditorPath, initialHairInput, readHairDraft, saveHairDraft, type HairstylePath } from '../hairstyles/drafts';
import { DressPicker, PhotoPicker } from './Selectors';
import { clearPending, findSubmission, readPending, savePending, sendSubmission, type DesignInput, type DesignType, type PendingSubmission, type Submission } from './api';
import './generation.css';

const modeOptions = [{ value: 'OVERALL', label: '整体设计' }, { value: 'OUTFIT', label: '只改穿搭' }];
function freshInput(profile: Profile): DesignInput {
  return { designType: 'OVERALL', personFileId: '', profileVersion: profile.version, requirements: '', occasion: '', style: '', weatherNote: '', requiredDressIds: [], useMeasurements: true, measurementId: null, constraintOverrides: [] };
}
function fromSource(profile: Profile, source?: DesignDetail): DesignInput {
  const base = freshInput(profile), old = source?.inputSummary;
  if (!old) return base;
  return { ...base, ...old.request, personFileId: old.personPhoto?.fileId || '', profileVersion: profile.version, constraintOverrides: [], requirements: old.request.requirements || '', occasion: old.request.occasion || '', style: old.request.style || '', weatherNote: old.request.weatherNote || '', requiredDressIds: old.request.requiredDressIds || [] };
}
export function NewDesignPage({ accountId, hair = false }: { accountId: string; hair?: boolean }) {
  const profile = useProfile(accountId);
  const location = useLocation();
  const sourceId = location.searchParams.get('from');
  const initialOccasion = (location.searchParams.get('occasion') || '').slice(0, 20);
  const requestedType = location.searchParams.get('type');
  const initialType = hair ? 'HAIRSTYLE' : requestedType === 'OUTFIT' ? 'OUTFIT' : undefined;
  const source = useQuery({ queryKey: ['design-source', accountId, sourceId], queryFn: ({ signal }) => request<DesignDetail>(`/designs/${encodeURIComponent(sourceId!)}`, { signal }), enabled: !!sourceId });
  const pending = readPending(accountId);
  const pendingOther = pending?.kind === 'CREATE' && (pending.input.designType === 'HAIRSTYLE') !== hair;
  const redirect = sourceId && source.data ? (source.data.designType === 'HAIRSTYLE') !== hair
    ? `${source.data.designType === 'HAIRSTYLE' ? '/app/hairstyles/try' : '/app/design/new'}?from=${encodeURIComponent(sourceId)}` : null
    : !sourceId && !hair && (requestedType === 'HAIRSTYLE' || pending?.kind === 'CREATE' && pending.input.designType === 'HAIRSTYLE')
      ? pending?.kind === 'CREATE' ? '/app/hairstyles/try' : '/app/hairstyles' : null;
  useEffect(() => { if (redirect) navigate(new URL(redirect, window.location.origin), true); }, [redirect]);
  const hairPath = hairEditorPath(location.searchParams.get('path'), source.data ? !!source.data.inputSummary?.request.hairstyleId : undefined, pending?.kind === 'CREATE' ? pending.input : undefined);
  const targetId = location.searchParams.get('hairstyleId'), targetVersion = location.searchParams.get('hairstyleVersion');
  const target = hair && targetId && targetVersion ? { id: targetId, version: targetVersion } : undefined;
  return <>
    <PageHeading title={hair ? '试发型' : '形象设计'} description={hair ? '以你的照片为基础，尝试一次新的造型。' : '今天，想看见怎样的自己？'} />
    {redirect || profile.isPending || sourceId && source.isPending ? <Card><Skeleton active paragraph={{ rows: 8 }} /></Card> : pendingOther ? <Alert type="warning" showIcon title="有一笔其他设计提交等待确认" description="请先查询原提交，不会在当前页面重复创建。" action={<Button href={hair ? '/app/design/new' : '/app/hairstyles/try'}>查看原提交</Button>} /> : profile.isError ? <QueryFailure error={profile.error} stale={false} loading={profile.isFetching} retry={() => void profile.refetch()} /> : sourceId && source.isError ? <Feedback type="error" title="原设计无法读取" description={source.error.message} action={<Button href={hair ? '/app/hairstyles' : '/app/design/new'}>从空白开始</Button>} /> : <EditorGate key={`${accountId}-${sourceId || 'new'}-${initialOccasion}-${initialType || ''}-${hairPath}-${targetId || ''}-${targetVersion || ''}`} accountId={accountId} profile={profile.data!} source={source.data} initialOccasion={initialOccasion} initialType={initialType} hairPath={hair ? hairPath : undefined} target={target} />}
  </>;
}
type EditorProps = { accountId: string; profile: Profile; source?: DesignDetail; initialOccasion?: string; initialType?: 'OUTFIT' | 'HAIRSTYLE'; hairPath?: HairstylePath; target?: { id: string; version: string } };
function EditorGate(props: EditorProps) {
  const [accepted, setAccepted] = useState(false);
  const saved = props.hairPath ? readHairDraft(props.accountId, props.hairPath) : undefined;
  if (props.source && saved && saved.sourceId !== props.source.id && !accepted && !readPending(props.accountId)) return <Alert className="hair-source-choice" type="info" showIcon title="已有一份未提交的发型设计" description="使用历史输入会替换当前方式的编辑草稿，另一种设计方式的草稿仍保留。" action={<Space wrap><Button href={`/app/hairstyles/try?path=${props.hairPath}`}>继续原草稿</Button><Button type="primary" onClick={() => setAccepted(true)}>使用历史输入</Button></Space>} />;
  return <DesignEditor {...props} />;
}
function DesignEditor({ accountId, profile, source, initialOccasion, initialType, hairPath, target }: EditorProps) {
  const client = useQueryClient();
  const [pending, setPending] = useState<PendingSubmission | null>(() => readPending(accountId));
  const [input, setInput] = useState<DesignInput>(() => {
    const recovery = readPending(accountId);
    if (recovery?.kind === 'CREATE') return recovery.input;
    const base = fromSource(profile, source);
    const fallback = source ? base : { ...base, occasion: initialOccasion || '', designType: initialType || base.designType, useMeasurements: initialType === 'HAIRSTYLE' ? false : base.useMeasurements };
    return hairPath ? initialHairInput(accountId, hairPath, fallback, target, source?.id) : fallback;
  });
  const [baseline, setBaseline] = useState(profile);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [uploads, setUploads] = useState<ImageDraft[]>([]);
  const previewSession = useDesignPreview();
  const { value: preview, inputKey: previewInput, open: previewOpen } = previewSession;
  const [photoLibraryOpen, setPhotoLibraryOpen] = useState(false);
  const [dressOpen, setDressOpen] = useState(false);
  const [images, setImages] = useState<Record<string, string>>(() => Object.fromEntries(source?.inputSummary?.requiredDresses?.map(d => [d.dressId, d.imageFileIds[0]]) || []));
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(source?.inputSummary?.requiredDresses?.map(d => [d.dressId, d.dressName]) || []));
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const submissionLock = useRef(false);
  const mounted = useRef(true);
  const completed = useRef(false);
  useEffect(() => { if (hairPath && !completed.current && !pending) saveHairDraft(accountId, hairPath, input, source?.id); }, [accountId, hairPath, input, pending, source?.id]);
  useEffect(() => {
    if (!hairPath || pending) return;
    const warn = (event: BeforeUnloadEvent) => { if (input.personFileId || input.requirements || input.hairstyleId) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [hairPath, input, pending]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const includesOutfit = input.designType !== 'HAIRSTYLE';
  const defaultPhotoId = input.designType === 'HAIRSTYLE' ? baseline.defaultPortraitId : baseline.defaultFullBodyId;
  const defaultPhoto = useQuery({ queryKey: ['default-design-photo', accountId, defaultPhotoId], queryFn: ({ signal }) => request<Photo>(`/photos/${defaultPhotoId}`, { signal }), enabled: !!defaultPhotoId && !input.personFileId && !pending });
  useEffect(() => {
    if (defaultPhoto.data && !input.personFileId && !pending) setInput(current => ({ ...current, personFileId: defaultPhoto.data.fileId }));
  }, [defaultPhoto.data, input.personFileId, pending]);
  const disabled = busy || checking || !!pending;
  const hasPendingUpload = uploads.some(item => !usableImage(item));
  const patch = (value: Partial<DesignInput>) => { previewSession.invalidate(); setInput(current => ({ ...current, ...value })); setError(''); };
  const readyPreview = !previewSession.loading && !previewSession.error && !!preview?.canSubmit && !!preview.previewToken && previewInput === JSON.stringify(input);
  function done(value: Submission, operation?: PendingSubmission) {
    clearPending(accountId);
    completed.current = true;
    completeHairSubmission(accountId, operation);
    void client.invalidateQueries({ queryKey: ['designs', accountId] });
    void client.invalidateQueries({ queryKey: ['workspace', accountId] });
    if (mounted.current) navigate(new URL(`/app/designs/${value.taskId}${hairPath ? '?from=hairstyles' : ''}`, window.location.origin), true);
  }
  async function recover(value = pending) {
    if (!value || submissionLock.current) return;
    submissionLock.current = true;
    setChecking(true); setError(''); setMissing(false);
    try { done(await findSubmission(value.key), value); }
    catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ApiError && failure.status === 404) { setMissing(true); setError('暂未找到该提交。可保持原输入重新预览，并使用原提交编号继续；不要重复新建任务。'); }
      else setError(failure instanceof Error ? failure.message : '提交结果查询失败');
    } finally { submissionLock.current = false; if (mounted.current) setChecking(false); }
  }
  useEffect(() => { const saved = readPending(accountId); if (saved) void recover(saved); }, []); // Restore only queries; never auto-resubmits.
  const refreshProfile = useMutation({ mutationFn: () => request<Profile>('/profile'), onSuccess: next => {
    setBaseline(next); client.setQueryData(['profile', accountId], next);
    if (!pending) { patch({ profileVersion: next.version, constraintOverrides: [] }); previewSession.invalidate(); }
    else setError('资料已刷新。待确认提交仍保留原输入；请先找回原提交，确认不存在后再放弃并调整。');
  }, onError: failure => setError(errorText(failure)) });
  function showPreview() {
    if (pending && !missing) { void recover(); return; }
    if (!input.personFileId || hasPendingUpload) { setError('请选择一张已上传完成的本人照片。'); return; }
    void previewSession.check(input);
  }
  async function submit() {
    if (!readyPreview || submissionLock.current) return;
    submissionLock.current = true; setBusy(true); setError('');
    const operation: PendingSubmission = { kind: 'CREATE', accountId, key: pending?.key || crypto.randomUUID(), input, previewToken: preview!.previewToken! };
    try {
      savePending(operation); setPending(operation); setMissing(false);
      done(await sendSubmission(operation), operation);
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ApiError && failure.status < 500 && failure.detail.code !== 'IDEMPOTENCY_CONFLICT') {
        clearPending(accountId); setPending(null); previewSession.invalidate(); previewSession.close();
        setError(errorText(failure));
      } else { previewSession.close(); setError(`${failure instanceof Error ? failure.message + '。' : ''}提交结果尚未确认，请先查询原提交，输入已保留。`); }
    } finally { submissionLock.current = false; if (mounted.current) setBusy(false); }
  }
  async function resendRetry() {
    if (pending?.kind !== 'RETRY' || !missing || submissionLock.current) return;
    submissionLock.current = true; setBusy(true);
    try { done(await sendSubmission(pending), pending); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '重试提交结果未确认，请查询原提交'); }
    finally { submissionLock.current = false; if (mounted.current) setBusy(false); }
  }
  function abandon() {
    Modal.confirm({ title: '放弃本地恢复记录？', content: '查询未找到不代表请求一定未被接受。放弃不会取消后台任务；请先查看工作台，避免重复生成。', okText: '放弃并调整输入', cancelText: '继续保留', onOk: () => { clearPending(accountId); setPending(null); setMissing(false); previewSession.invalidate(); patch({ profileVersion: baseline.version, constraintOverrides: [] }); } });
  }
  return <>
    {source ? <Alert className="feature-notice" showIcon type={source.status === 'UNKNOWN' ? 'warning' : 'info'} title={source.status === 'UNKNOWN' ? '原任务仍可能完成' : '已带入原设计输入'} description="这将创建新的设计。当前资料和资源会重新核验，单次限制例外需重新选择。" /> : null}
    {pending ? <Feedback type="warning" title="有一笔提交等待确认" description={<><p>已保留原提交编号和输入，不会自动再次生成。</p><Space wrap><Button loading={checking} disabled={busy} onClick={() => void recover()}>查询原提交</Button><Button href="/app">查看工作台</Button>{missing ? <><Button disabled={busy} onClick={pending.kind === 'CREATE' ? showPreview : () => void resendRetry()}>{pending.kind === 'CREATE' ? '保持原输入重新预览' : '使用原编号重提重试'}</Button><Button disabled={busy} onClick={abandon}>放弃本地恢复记录</Button></> : null}</Space></>} /> : null}
    {error ? <Feedback type="error" title={error} description={<Space wrap><Button loading={refreshProfile.isPending} disabled={busy || checking} onClick={() => refreshProfile.mutate()}>刷新个人资料</Button><Button href="/app">查看工作台</Button></Space>} /> : null}
    {!hairPath ? <><Button className="hair-trial-nav" href="/app/hairstyles">前往发型设计专区</Button><Radio.Group className="creation-modes" aria-label="设计模式" value={input.designType} disabled={disabled} options={modeOptions} optionType="button" buttonStyle="solid" onChange={e => { const mode = e.target.value as DesignType; patch({ designType: mode, useMeasurements: mode !== 'HAIRSTYLE', measurementId: null, requiredDressIds: mode === 'HAIRSTYLE' ? [] : input.requiredDressIds, weatherNote: mode === 'HAIRSTYLE' ? '' : input.weatherNote, hairstyleId: null, hairstyleVersion: null, useReferenceHairColor: false, constraintOverrides: [] }); }} /></> : null}
    {input.designType === 'HAIRSTYLE' ? <HairstyleStudio accountId={accountId} input={input} patch={patch} initialReference={source?.inputSummary?.hairstyleReference} path={pending?.kind === 'CREATE' ? input.hairstyleId ? 'gallery' : 'free' : hairPath || (input.hairstyleId ? 'gallery' : 'free')} disabled={disabled} hasPendingUpload={hasPendingUpload} previewLoading={previewSession.loading} photoError={defaultPhoto.isError} onPhoto={() => setPhotoOpen(true)} onPreview={showPreview} /> : <div className="creation-studio">
      <section className="creation-controls" aria-label="设计要求">
        <div className="creation-eyebrow">专属于你的造型提案</div>
        <Form layout="vertical" disabled={disabled} className="creation-form">
          <Form.Item label="这次想尝试什么？" htmlFor="design-requirements" extra="选填。可以聊聊想法，也可以交给我们寻找灵感。"><Input.TextArea id="design-requirements" value={input.requirements} onChange={e => patch({ requirements: e.target.value })} maxLength={2000} showCount rows={4} placeholder="例如：明天上班，想穿得轻松一点，保留自然的发型……" /></Form.Item>
          <Form.Item label="准备去哪里？" htmlFor="design-occasion"><div className="creation-occasion-chips">{['日常', '通勤', '约会', '聚会', '出游'].map(value => <Button key={value} aria-pressed={input.occasion === value} type={input.occasion === value ? 'primary' : 'default'} disabled={disabled} onClick={() => patch({ occasion: input.occasion === value ? '' : value })}>{value}</Button>)}</div><Input id="design-occasion" value={input.occasion} maxLength={100} onChange={e => patch({ occasion: e.target.value })} placeholder="也可以填写其他场合，留空按日常设计" /></Form.Item>
          <Collapse ghost className="creation-more" items={[{ key: 'more', label: '更多设计条件', extra: <span className="creation-more-summary">{[input.style && '已选风格', includesOutfit && input.weatherNote && '已填天气', includesOutfit && input.useMeasurements && baseline.currentMeasurement && '参考尺寸'].filter(Boolean).join(' · ') || '选填'}</span>, children: <>
            <Form.Item label="想尝试的风格" htmlFor="design-style"><Input id="design-style" value={input.style} maxLength={100} onChange={e => patch({ style: e.target.value })} placeholder="例如：简洁、复古，留空参考已有偏好" /></Form.Item>
            {includesOutfit ? <><Form.Item label="天气与使用环境" htmlFor="design-weather"><Input id="design-weather" value={input.weatherNote} maxLength={200} onChange={e => patch({ weatherNote: e.target.value })} placeholder="例如：15℃左右，室外通勤、室内办公" /></Form.Item><Checkbox checked={input.useMeasurements} onChange={e => patch({ useMeasurements: e.target.checked, measurementId: null })}>参考当前身体尺寸</Checkbox><Typography.Paragraph type="secondary">{baseline.currentMeasurement ? '用于辅助判断比例，不推测未提供的尺寸。' : '尚未提供当前尺寸，也可以生成。'}</Typography.Paragraph>{input.measurementId ? <Alert type="info" title="正在沿用历史尺寸" action={<Button disabled={disabled} onClick={() => patch({ measurementId: null })}>改用当前尺寸</Button>} /> : null}</> : null}
          </> }]} />
        </Form>
        <div className="creation-profile-summary"><span aria-hidden="true">✧</span><div><strong>也会参考你的个人偏好</strong><p>{baseline.preferences?.styles?.length ? baseline.preferences.styles.map(v => v.type === 'CUSTOM' ? v.text : dictionaries.styles[v.code as keyof typeof dictionaries.styles] || v.code).join('、') : '没有预设偏好也没关系，我们会从已有素材中寻找灵感。'}</p><small>完整资料与明确限制会在下一步展示。</small></div></div>
        <div className="creation-submit"><div className="creation-section-row"><strong>一套方案，一张效果图</strong><span>仅使用本次选择</span></div><Button type="primary" size="large" block loading={previewSession.loading} disabled={disabled || hasPendingUpload || !input.personFileId} onClick={showPreview}>继续，确认设计</Button><p>{!input.personFileId ? '先添加一张本人照片，即可继续。' : hasPendingUpload ? '请等待照片上传完成，或移除未完成的上传。' : '先核对设计依据，再开始生成。提交后可以离开页面。'}</p><small>效果图展示设计意图，不代表真实合身或服装性能验证。</small></div>
      </section>
      <section className="creation-materials" aria-label="本次设计素材">
        <div className="creation-photo-stage">
          <div className="creation-photo-label">YOUR LOOK · 本人照片</div>
          {input.personFileId ? <PrivateImage accountId={accountId} fileId={input.personFileId} alt="本次设计使用的本人照片" hideRefresh /> : <div className="creation-photo-empty"><span className="creation-photo-symbol" aria-hidden="true">＋</span><Typography.Title level={3}>从一张自己的照片开始</Typography.Title><Typography.Paragraph>清晰、自然的照片，让设计更贴近你。</Typography.Paragraph><Button type="primary" size="large" disabled={disabled} onClick={() => setPhotoOpen(true)}>添加本人照片</Button></div>}
        </div>
        <div className="creation-photo-toolbar"><div><strong>{input.personFileId ? '这一次，以你为主角' : '准备好你的照片'}</strong><p>{includesOutfit ? '建议使用能看清全身比例的照片。' : '建议使用面部和头发清晰可见的照片。'} 切换模式会保留已选照片。</p></div>{input.personFileId ? <Button disabled={disabled} onClick={() => setPhotoOpen(true)}>更换照片</Button> : null}</div>
        {defaultPhoto.isError ? <Feedback type="warning" title="默认照片无法读取，请手动选择" /> : null}
        {includesOutfit ? <div className="creation-wardrobe"><div className="creation-section-row"><div><h3>这次想穿的单品</h3><p>{input.requiredDressIds.length ? `已指定 ${input.requiredDressIds.length} 件必穿单品` : '由 AI 从你的衣橱搭配，也可以指定必穿单品。'}</p></div><Button disabled={disabled} onClick={() => setDressOpen(true)}>＋ 从衣橱添加</Button></div>{input.requiredDressIds.length ? <div className="creation-selected-items">{input.requiredDressIds.map(id => <div className="creation-selected-item" key={id}>{images[id] ? <PrivateImage accountId={accountId} fileId={images[id]} thumbnail compact alt={names[id] || '必穿单品'} /> : <div className="creation-item-placeholder">衣物</div>}<span>{names[id] || `单品 ${id}`}</span><Button type="text" size="small" disabled={disabled} aria-label={`移除必穿单品 ${names[id] || id}`} onClick={() => patch({ requiredDressIds: input.requiredDressIds.filter(v => v !== id) })}>移除</Button></div>)}</div> : null}</div> : null}
      </section>
    </div>}
    <Modal open={photoOpen} title={input.personFileId ? '更换本人照片' : '添加本人照片'} onCancel={() => setPhotoOpen(false)} footer={<Button onClick={() => setPhotoOpen(false)}>完成</Button>}>
      <p>选择照片库中的照片，或上传一张用于本次设计的照片。</p><Button disabled={disabled} onClick={() => setPhotoLibraryOpen(true)}>从照片库选择</Button>
      <div className="generation-upload"><ImageUpload accountId={accountId} mode="design" maxFiles={1} items={uploads} disabled={disabled} setItems={setUploads} />{uploads.map(item => <Button key={item.key} type="primary" disabled={disabled || !usableImage(item)} onClick={() => { patch({ personFileId: item.fileId! }); setPhotoOpen(false); }}>使用上传照片{input.personFileId === item.fileId ? '（已选）' : ''}</Button>)}<Typography.Paragraph type="secondary">上传照片仅用于本次设计，不自动加入照片库。一次使用一张本人照片。</Typography.Paragraph></div>
    </Modal>
    {photoLibraryOpen ? <PhotoPicker accountId={accountId} value={input.personFileId} onSelect={fileId => { patch({ personFileId: fileId }); setPhotoOpen(false); }} onClose={() => setPhotoLibraryOpen(false)} /> : null}
    <Drawer title="选择必穿单品" open={dressOpen} onClose={() => setDressOpen(false)} size={640} footer={<Button type="primary" block onClick={() => setDressOpen(false)}>完成选择{input.requiredDressIds.length ? ` · ${input.requiredDressIds.length} 件` : ''}</Button>}><fieldset className="generation-fieldset" disabled={disabled}><DressPicker accountId={accountId} ids={input.requiredDressIds} names={names} onChange={(ids, dress) => { if (disabled) return; patch({ requiredDressIds: ids }); if (dress) { setNames(current => ({ ...current, [dress.id]: dress.name })); setImages(current => ({ ...current, [dress.id]: dress.images[0]?.fileId || '' })); } }} /></fieldset></Drawer>
    <Modal open={previewOpen} width={720} title="确认本次设计" onCancel={() => { if (!busy) previewSession.close(); }} mask={{ closable: !busy }} closable={!busy} footer={<Space><Button disabled={busy} onClick={previewSession.close}>返回修改</Button>{previewSession.error ? <Button loading={previewSession.loading} disabled={busy} onClick={showPreview}>重新核验</Button> : null}<Button type="primary" loading={busy} disabled={!readyPreview} onClick={() => void submit()}>确认并开始生成</Button></Space>}>
      <DescriptionsRequest input={input} />
      {previewSession.loading ? <Typography.Paragraph role="status">正在核验本次设计依据……</Typography.Paragraph> : null}
      {previewSession.error ? <Alert type="error" showIcon title="暂时无法继续" description={errorText(previewSession.error)} action={<Button loading={refreshProfile.isPending} disabled={busy} onClick={() => { previewSession.close(); refreshProfile.mutate(); }}>刷新个人资料</Button>} /> : null}
      {preview ? <PreviewDetails includesOutfit={includesOutfit} accountId={accountId} value={preview} overrides={input.constraintOverrides} disabled={busy || !!pending} onOverrides={ids => { if (!busy && !pending) { const next = { ...input, constraintOverrides: ids }; patch({ constraintOverrides: ids }); void previewSession.check(next); } }} /> : previewSession.loading ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
    </Modal>
  </>;
}
function DescriptionsRequest({ input }: { input: DesignInput }) {
  return <div className="generation-request-summary"><Typography.Text strong>{designTypeName(input.designType)}</Typography.Text><Typography.Paragraph className="task-text">{input.requirements || '没有额外设计要求'}</Typography.Paragraph>{input.designType === 'HAIRSTYLE' && input.hairstyleId ? <Typography.Paragraph type="secondary">以所选发型为基础{input.requirements ? '，优先按以上明确要求调整' : '，尽量还原造型'}；{input.useReferenceHairColor ? '同时尝试参考发色' : '保留本人发色'}。</Typography.Paragraph> : null}<Typography.Paragraph type="secondary">场合：{input.occasion || '日常'} · 风格：{input.style || '参考已有偏好'}{input.designType !== 'HAIRSTYLE' ? ` · 天气：${input.weatherNote || '未提供'}` : ''}</Typography.Paragraph></div>;
}

function errorText(failure: Error) { return failure instanceof ApiError && failure.detail.fieldErrors?.length ? [failure.message, ...failure.detail.fieldErrors.map(v => v.message)].join('；') : failure.message; }
