import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Radio, Skeleton, Space, Tag, Typography } from 'antd';
import { ApiError, request } from '../../api/client';
import { navigate, useLocation } from '../../app/navigation';
import { useProfile, type Photo, type Profile } from '../profile/queries';
import { ImageUpload, usableImage, type ImageDraft } from '../wardrobe/ImageUpload';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { QueryFailure, designTypeName } from '../workspace/TaskViews';
import type { DesignDetail } from '../workspace/queries';
import { PreviewDetails } from './PreviewDetails';
import { DressPicker, PhotoPicker } from './Selectors';
import { clearPending, findSubmission, readPending, savePending, sendSubmission, type DesignInput, type DesignType, type PendingSubmission, type Preview, type Submission } from './api';
import './generation.css';

const modeOptions = [{ value: 'OVERALL', label: '整体设计' }, { value: 'HAIRSTYLE', label: '只改发型' }, { value: 'OUTFIT', label: '只改穿搭' }];
function freshInput(profile: Profile): DesignInput {
  return { designType: 'OVERALL', personFileId: '', profileVersion: profile.version, requirements: '', occasion: '', style: '', weatherNote: '', requiredDressIds: [], useMeasurements: true, measurementId: null, constraintOverrides: [] };
}
function fromSource(profile: Profile, source?: DesignDetail): DesignInput {
  const base = freshInput(profile), old = source?.inputSummary;
  if (!old) return base;
  return { ...base, ...old.request, personFileId: old.personPhoto?.fileId || '', profileVersion: profile.version, constraintOverrides: [], requirements: old.request.requirements || '', occasion: old.request.occasion || '', style: old.request.style || '', weatherNote: old.request.weatherNote || '', requiredDressIds: old.request.requiredDressIds || [] };
}
export function NewDesignPage({ accountId }: { accountId: string }) {
  const profile = useProfile(accountId);
  const sourceId = useLocation().searchParams.get('from');
  const source = useQuery({ queryKey: ['design-source', accountId, sourceId], queryFn: ({ signal }) => request<DesignDetail>(`/designs/${encodeURIComponent(sourceId!)}`, { signal }), enabled: !!sourceId });
  if (profile.isPending || sourceId && source.isPending) return <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>;
  if (profile.isError) return <QueryFailure error={profile.error} stale={false} loading={profile.isFetching} retry={() => void profile.refetch()} />;
  if (sourceId && source.isError) return <Alert type="error" showIcon title="原设计无法读取" description={source.error.message} action={<Button href="/app/design/new">从空白开始</Button>} />;
  return <DesignEditor key={`${accountId}-${sourceId || 'new'}`} accountId={accountId} profile={profile.data!} source={source.data} />;
}
function DesignEditor({ accountId, profile, source }: { accountId: string; profile: Profile; source?: DesignDetail }) {
  const client = useQueryClient();
  const [pending, setPending] = useState<PendingSubmission | null>(() => readPending(accountId));
  const [input, setInput] = useState<DesignInput>(() => {
    const recovery = readPending(accountId);
    return recovery?.kind === 'CREATE' ? recovery.input : fromSource(profile, source);
  });
  const [baseline, setBaseline] = useState(profile);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [uploads, setUploads] = useState<ImageDraft[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewInput, setPreviewInput] = useState('');
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(source?.inputSummary?.requiredDresses?.map(d => [d.dressId, d.dressName]) || []));
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const submissionLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const includesOutfit = input.designType !== 'HAIRSTYLE';
  const defaultPhotoId = input.designType === 'HAIRSTYLE' ? baseline.defaultPortraitId : baseline.defaultFullBodyId;
  const defaultPhoto = useQuery({ queryKey: ['default-design-photo', accountId, defaultPhotoId], queryFn: ({ signal }) => request<Photo>(`/photos/${defaultPhotoId}`, { signal }), enabled: !!defaultPhotoId && !input.personFileId && !pending });
  useEffect(() => {
    if (defaultPhoto.data && !input.personFileId && !pending) setInput(current => ({ ...current, personFileId: defaultPhoto.data.fileId }));
  }, [defaultPhoto.data, input.personFileId, pending]);
  const disabled = busy || checking || !!pending;
  const hasUnverifiedUpload = uploads.some(item => !usableImage(item));
  const patch = (value: Partial<DesignInput>) => { setInput(current => ({ ...current, ...value })); setError(''); };
  const readyPreview = !!preview?.canSubmit && !!preview.previewToken && previewInput === JSON.stringify(input);
  function done(value: Submission) {
    clearPending(accountId);
    void client.invalidateQueries({ queryKey: ['workspace', accountId] });
    if (mounted.current) navigate(new URL(`/app/designs/${value.taskId}`, window.location.origin));
  }
  async function recover(value = pending) {
    if (!value || submissionLock.current) return;
    submissionLock.current = true;
    setChecking(true); setError(''); setMissing(false);
    try { done(await findSubmission(value.key)); }
    catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ApiError && failure.status === 404) { setMissing(true); setError('暂未找到该提交。可保持原输入重新预览，并使用原提交编号继续；不要重复新建任务。'); }
      else setError(failure instanceof Error ? failure.message : '提交结果查询失败');
    } finally { submissionLock.current = false; if (mounted.current) setChecking(false); }
  }
  useEffect(() => { const saved = readPending(accountId); if (saved) void recover(saved); }, []); // Restore only queries; never auto-resubmits.
  const previewMutation = useMutation({ mutationFn: (value: DesignInput) => request<Preview>('/designs/preview', { method: 'POST', body: value }), onSuccess: (value, variables) => {
    setPreview(value); setPreviewInput(JSON.stringify(variables)); setPreviewOpen(true); setError('');
  }, onError: failure => setError(errorText(failure)) });
  const refreshProfile = useMutation({ mutationFn: () => request<Profile>('/profile'), onSuccess: next => {
    setBaseline(next); client.setQueryData(['profile', accountId], next);
    if (!pending) { patch({ profileVersion: next.version, constraintOverrides: [] }); setPreview(null); }
    else setError('资料已刷新。待确认提交仍保留原输入；请先找回原提交，确认不存在后再放弃并调整。');
  }, onError: failure => setError(errorText(failure)) });
  function showPreview() {
    if (pending && !missing) { void recover(); return; }
    if (!input.personFileId || hasUnverifiedUpload) { setError('请选择一张已完成核验的本人照片。'); return; }
    previewMutation.mutate(input);
  }
  async function submit() {
    if (!readyPreview || submissionLock.current) return;
    submissionLock.current = true; setBusy(true); setError('');
    const operation: PendingSubmission = { kind: 'CREATE', accountId, key: pending?.key || crypto.randomUUID(), input, previewToken: preview!.previewToken! };
    try {
      savePending(operation); setPending(operation); setMissing(false);
      done(await sendSubmission(operation));
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ApiError && failure.status < 500 && failure.detail.code !== 'IDEMPOTENCY_CONFLICT') {
        clearPending(accountId); setPending(null); setPreview(null); setPreviewOpen(false);
        setError(errorText(failure));
      } else { setPreviewOpen(false); setError(`${failure instanceof Error ? failure.message + '。' : ''}提交结果尚未确认，请先查询原提交，输入已保留。`); }
    } finally { submissionLock.current = false; if (mounted.current) setBusy(false); }
  }
  async function resendRetry() {
    if (pending?.kind !== 'RETRY' || !missing || submissionLock.current) return;
    submissionLock.current = true; setBusy(true);
    try { done(await sendSubmission(pending)); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '重试提交结果未确认，请查询原提交'); }
    finally { submissionLock.current = false; if (mounted.current) setBusy(false); }
  }
  function abandon() {
    Modal.confirm({ title: '放弃本地恢复记录？', content: '查询未找到不代表请求一定未被接受。放弃不会取消后台任务；请先查看工作台，避免重复生成。', okText: '放弃并调整输入', cancelText: '继续保留', onOk: () => { clearPending(accountId); setPending(null); setMissing(false); setPreview(null); patch({ profileVersion: baseline.version, constraintOverrides: [] }); } });
  }
  return <>
    <div className="section-heading"><div><Typography.Title level={2}>这一次，想尝试什么风格？</Typography.Title><Typography.Paragraph type="secondary">用自己的照片和衣橱，尝试新的形象。</Typography.Paragraph></div><Button href="/app/designs">返回设计记录</Button></div>
    {source ? <Alert className="feature-notice" showIcon type={source.status === 'UNKNOWN' ? 'warning' : 'info'} title={source.status === 'UNKNOWN' ? '原任务仍可能完成' : '已带入原设计输入'} description="这将创建新的设计。当前资料和资源会重新核验，单次限制例外需重新选择。" /> : null}
    {pending ? <Alert className="feature-notice" showIcon type="warning" title="有一笔提交等待确认" description={<><p>已保留原提交编号和输入，不会自动再次生成。</p><Space wrap><Button loading={checking} disabled={busy} onClick={() => void recover()}>查询原提交</Button><Button href="/app">查看工作台</Button>{missing ? <><Button disabled={busy} onClick={pending.kind === 'CREATE' ? showPreview : () => void resendRetry()}>{pending.kind === 'CREATE' ? '保持原输入重新预览' : '使用原编号重提重试'}</Button><Button disabled={busy} onClick={abandon}>放弃本地恢复记录</Button></> : null}</Space></>} /> : null}
    {error ? <Alert className="feature-notice" type="error" showIcon title={error} description={<Space wrap><Button loading={refreshProfile.isPending} disabled={busy || checking} onClick={() => refreshProfile.mutate()}>刷新个人资料</Button><Button href="/app">查看工作台</Button></Space>} /> : null}
    <div className="design-layout"><div className="design-form-column">
      <Card title="01 选择设计模式"><Radio.Group value={input.designType} disabled={disabled} options={modeOptions} optionType="button" buttonStyle="solid" onChange={e => { const mode = e.target.value as DesignType; patch({ designType: mode, useMeasurements: mode !== 'HAIRSTYLE', measurementId: null, requiredDressIds: mode === 'HAIRSTYLE' ? [] : input.requiredDressIds, weatherNote: mode === 'HAIRSTYLE' ? '' : input.weatherNote, constraintOverrides: [] }); }} /><Typography.Paragraph type="secondary" className="mode-description">{includesOutfit ? '已有衣橱须能组成完整基础穿搭。未选用衣橱鞋子时，可生成明确标注的示意鞋。' : '只调整发型，保留本人的其他特征。'}</Typography.Paragraph></Card>
      <Card title="02 选择本人照片"><div className="generation-person-preview">{input.personFileId ? <PrivateImage accountId={accountId} fileId={input.personFileId} alt="已选择的本人照片" /> : <Typography.Paragraph type="secondary">请选择一张清晰的本人照片。</Typography.Paragraph>}</div>
        <Space wrap><Button disabled={disabled} onClick={() => setPhotoOpen(true)}>从照片库选择</Button><Button href="/app/profile?tab=photos">管理照片库</Button></Space>
        {defaultPhoto.isError ? <Alert type="warning" title="默认照片无法读取，请手动选择" /> : null}
        <div className="generation-upload"><ImageUpload accountId={accountId} mode="design" maxFiles={1} items={uploads} disabled={disabled} setItems={setUploads} />{uploads.length ? <Space wrap>{uploads.map(item => <Button key={item.key} disabled={disabled || !usableImage(item)} onClick={() => patch({ personFileId: item.fileId! })}>使用上传照片{input.personFileId === item.fileId ? '（已选）' : ''}</Button>)}</Space> : null}<Typography.Paragraph type="secondary">上传的照片仅用于本次设计，不自动加入照片库。一次只能使用一张本人照片。</Typography.Paragraph></div>
      </Card>
      <Card title="03 告诉我们你的想法"><Form layout="vertical" disabled={disabled}>
        <Form.Item label="设计要求" htmlFor="design-requirements" extra="选填。明确的必须、不能与必穿要求会优先遵守。"><Input.TextArea id="design-requirements" value={input.requirements} onChange={e => patch({ requirements: e.target.value })} maxLength={2000} showCount rows={4} placeholder="例如：日常通勤，希望自然简洁，穿着方便走路……" /></Form.Item>
        <Form.Item label="使用场合" htmlFor="design-occasion"><Input id="design-occasion" value={input.occasion} maxLength={100} onChange={e => patch({ occasion: e.target.value })} placeholder="选填，未填写按日常设计" /></Form.Item>
        <Form.Item label="想尝试的风格" htmlFor="design-style"><Input id="design-style" value={input.style} maxLength={100} onChange={e => patch({ style: e.target.value })} placeholder="选填，未填写参考已有偏好" /></Form.Item>
        {includesOutfit ? <><Form.Item label="天气与使用环境" htmlFor="design-weather"><Input id="design-weather" value={input.weatherNote} maxLength={200} onChange={e => patch({ weatherNote: e.target.value })} placeholder="例如：15℃左右，室外通勤、室内办公；选填" /></Form.Item><Checkbox checked={input.useMeasurements} onChange={e => patch({ useMeasurements: e.target.checked, measurementId: null })}>使用当前身体尺寸（可选）</Checkbox><Typography.Paragraph type="secondary">{baseline.currentMeasurement ? '提交前会展示实际使用的尺寸；未提供的尺寸不作猜测。' : '尚未提供当前尺寸，也可以生成。'}</Typography.Paragraph>{input.measurementId ? <Alert type="info" title={`沿用历史尺寸 ${input.measurementId}`} action={<Button onClick={() => patch({ measurementId: null })}>改用当前尺寸</Button>} /> : null}</> : null}
      </Form></Card>
      {includesOutfit ? <Card title="04 指定必穿单品（可选）"><fieldset className="generation-fieldset" disabled={disabled}><DressPicker accountId={accountId} ids={input.requiredDressIds} names={names} onChange={(ids, dress) => { if (disabled) return; patch({ requiredDressIds: ids }); if (dress) setNames(current => ({ ...current, [dress.id]: dress.name })); }} /></fieldset></Card> : null}
    </div><aside><Card className="design-summary" title="本次设计"><Tag color="green">{designTypeName(input.designType)}</Tag><Typography.Title level={4}>一套方案，一张效果图</Typography.Title><Typography.Paragraph type="secondary">提交前核对照片、实际资料及明确限制。提交后可离开页面，稍后在设计记录查看结果。</Typography.Paragraph><div className="summary-check"><span>本人照片</span><Typography.Text>{input.personFileId ? '已选择' : '待选择'}</Typography.Text></div>{includesOutfit ? <div className="summary-check"><span>必穿单品</span><Typography.Text>{input.requiredDressIds.length ? `${input.requiredDressIds.length} 件` : '自动选衣'}</Typography.Text></div> : null}<Button className="generate-button" type="primary" size="large" block loading={previewMutation.isPending} disabled={disabled || hasUnverifiedUpload || !input.personFileId} onClick={showPreview}>预览本次输入</Button><Typography.Paragraph type="secondary">效果图展示设计意图，不代表真实合身或服装性能验证。</Typography.Paragraph></Card></aside></div>
    {photoOpen ? <PhotoPicker accountId={accountId} value={input.personFileId} onSelect={fileId => patch({ personFileId: fileId })} onClose={() => setPhotoOpen(false)} /> : null}
    <Modal open={previewOpen} width={760} title="确认本次设计输入" onCancel={() => { if (!busy) setPreviewOpen(false); }} mask={{ closable: !busy }} closable={!busy} footer={<Space><Button disabled={busy} onClick={() => setPreviewOpen(false)}>返回修改</Button>{!readyPreview ? <Button loading={previewMutation.isPending} disabled={busy} onClick={showPreview}>重新预览</Button> : null}<Button type="primary" loading={busy} disabled={!readyPreview || previewMutation.isPending} onClick={() => void submit()}>确认并开始生成</Button></Space>}>
      {preview ? <><DescriptionsRequest input={input} /><PreviewDetails includesOutfit={includesOutfit} accountId={accountId} value={preview} overrides={input.constraintOverrides} onOverrides={ids => { if (!busy && !pending) patch({ constraintOverrides: ids }); }} />{previewInput !== JSON.stringify(input) ? <Alert showIcon type="warning" title="输入已修改，请重新预览后提交" /> : null}</> : null}
    </Modal>
  </>;
}
function DescriptionsRequest({ input }: { input: DesignInput }) {
  return <div className="generation-request-summary"><Typography.Text strong>{designTypeName(input.designType)}</Typography.Text><Typography.Paragraph className="task-text">{input.requirements || '没有额外设计要求'}</Typography.Paragraph><Typography.Paragraph type="secondary">场合：{input.occasion || '日常'} · 风格：{input.style || '参考已有偏好'}{input.designType !== 'HAIRSTYLE' ? ` · 天气：${input.weatherNote || '未提供'}` : ''}</Typography.Paragraph></div>;
}

function errorText(failure: Error) { return failure instanceof ApiError && failure.detail.fieldErrors?.length ? [failure.message, ...failure.detail.fieldErrors.map(v => v.message)].join('；') : failure.message; }
