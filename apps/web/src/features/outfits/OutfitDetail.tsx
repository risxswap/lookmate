import { Feedback } from '../../components/Feedback';
import { PageHeading } from '../../components/PageHeading';
import { usePageState } from '../../app/navigation';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Collapse, Dropdown, Modal, Skeleton, Space, Tag, Typography } from 'antd';
import { ApiError, request } from '../../api/client';
import { navigate } from '../../app/navigation';
import { DressDetail } from '../wardrobe/DressDetail';
import { useCategories } from '../wardrobe/queries';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { PhotoPicker } from '../generation/Selectors';
import { isActive } from '../workspace/queries';
import { usePageBounds } from '../designs/queries';
import { OutfitBoard } from './OutfitsList';
import { OutfitHistory } from './OutfitHistory';
import { persistPendingJob, readPendingJob, submitJob, useJobs, useCurrentOutfitJobs, useOutfit, useOutfitWrite, type Outfit, type OutfitJob, type PendingOutfitJob } from './api';
import '../generation/generation.css';
export function OutfitDetail({ accountId, id }: { accountId: string; id: string }) {
  const query = useOutfit(accountId, id); const write = useOutfitWrite(accountId); const outfit = query.data;
  const [selectedDressId, setSelectedDressId] = useState<string>();
  const categories = useCategories(accountId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const current = useCurrentOutfitJobs(accountId, id);
  const currentImage = current.data?.image && current.data.image.revision === outfit?.revision && !current.data?.image?.stale ? current.data.image : null;
  const imageId = currentImage?.outputFileId || (outfit?.revision === '0' ? outfit.sourceOutputFileId : null);
  return <><PageHeading title={outfit?.name || '搭配详情'} description={outfit ? `${outfit.groups.map(g => g.name).join(' / ') || '未分组'} · ${outfit.items.length} 件单品` : undefined} action={<Space><Button onClick={() => { void query.refetch(); void current.refetch(); }}>刷新</Button>{outfit && <><Button href={`/app/wardrobe/outfits/${id}/edit`}>编辑搭配</Button><Dropdown trigger={['click']} menu={{items:[{key:'pin',label:outfit.pinned?'取消置顶':'置顶到工作台'},{key:'delete',label:'删除搭配',danger:true}],onClick:({key})=>{if(key==='delete')setDeleteOpen(true);else write.mutate({path:`/outfits/${id}`,method:'PATCH',body:{version:outfit.version,pinned:!outfit.pinned}});}}}><Button loading={write.isPending}>更多</Button></Dropdown></>}</Space>} />
    {query.isError && <Feedback eventKey={query.error} type="error" title={query.error.message} />}{write.isError && <Feedback eventKey={write.error} type="error" title={write.error.message} />}{query.isPending && <Skeleton active />}
    {outfit && <><div className="outfit-detail outfit-detail-focused"><div className="outfit-detail-content"><section><Typography.Title level={4}>搭配单品</Typography.Title><div className="outfit-compact-items">{outfit.items.map(item=><div className="outfit-compact-item" key={item.dressId}><Button type="text" className="outfit-item-detail-trigger" disabled={item.missing} aria-label={`查看${item.dressName}详情`} onClick={()=>setSelectedDressId(item.dressId)} />{item.imageFileIds[0] && <PrivateImage hideRefresh accountId={accountId} fileId={item.imageFileIds[0]} thumbnail compact preview={false} alt={item.dressName}/>}<div><strong>{item.dressName}</strong>{item.missing && <Tag color="orange">单品已删除</Tag>}</div></div>)}</div></section><section><Typography.Title level={4}>我的穿法</Typography.Title>{outfit.note ? <Typography.Paragraph className="task-text">{outfit.note}</Typography.Paragraph>:<Button type="link" href={`/app/wardrobe/outfits/${id}/edit`}>添加穿法</Button>}</section>{outfit.items.some(i=>i.missing) && <Alert type="warning" title="这套搭配含已删除的单品" description="原快照仍保留，生成效果图前请编辑替换。"/>}<OutfitAi key={id} accountId={accountId} outfit={outfit}/></div><div className="outfit-detail-picture">{imageId ? <PrivateImage hideRefresh accountId={accountId} fileId={imageId} alt="当前搭配效果图"/>:<OutfitBoard accountId={accountId} outfit={outfit}/>} {currentImage?.result?.notices?.map((n,i)=><Alert key={i} type={n.severity==='WARNING'?'warning':'info'} title={n.message}/>)}{currentImage?.result?.illustrativeShoes && <Alert type="info" title="鞋子为 AI 生成示意，非衣橱单品" description={currentImage.result.illustrativeShoes.description}/>}</div></div></>}
    {selectedDressId && <DressDetail key={selectedDressId} accountId={accountId} id={selectedDressId} categories={categories.data ?? []} onClose={()=>setSelectedDressId(undefined)}/>}
    <Modal open={deleteOpen} title="删除这套搭配？" okText="删除" okButtonProps={{danger:true}} confirmLoading={write.isPending} onCancel={()=>setDeleteOpen(false)} onOk={async()=>{if(!outfit)return;try{await write.mutateAsync({path:`/outfits/${id}?version=${outfit.version}`,method:'DELETE'});navigate(new URL('/app/wardrobe?tab=outfits',window.location.origin));}catch{/* Error displayed above. */}}}>已创建的 AI 任务会保留其独立历史记录。</Modal>
  </>;
}

function OutfitAi({ accountId, outfit }: { accountId: string; outfit: Outfit }) {
  const [page, setPage] = usePageState(`${accountId}:outfit-jobs`, 'page', 1); const query = useJobs(accountId, outfit.id, page); const client = useQueryClient(); const [pending, setPending] = useState(() => readPendingJob(accountId, outfit.id)); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const guard = useRef(false); const [photoOpen, setPhotoOpen] = useState(false); const [picker, setPicker] = useState(false); const [photo, setPhoto] = useState('');
  const current = useCurrentOutfitJobs(accountId, outfit.id); const [historyOpen, setHistoryOpen] = useState(false); const [selected, setSelected] = useState<string | null>(null);
  const evaluation = current.data?.evaluation?.revision === outfit.revision && !current.data.evaluation.stale ? current.data.evaluation : null;
  const latest = current.data?.latest?.revision === outfit.revision && !current.data.latest.stale ? current.data.latest : null;
  const processing = !!latest && isActive(latest.status);
  usePageBounds(query.data?.total, 5, query.isSuccess && !query.isFetching, setPage);
  function remember(value: PendingOutfitJob | null) { persistPendingJob(accountId, outfit.id, value); setPending(value); }
  async function accept() { remember(null); setPage(1); await Promise.all(['outfit-jobs', 'outfit-current-jobs', 'workspace'].map(k => client.invalidateQueries({ queryKey: [k, accountId] }))); }
  async function send(value: PendingOutfitJob) { if (guard.current) return; guard.current = true; setBusy(true); setError(''); try { remember(value); await submitJob(value); await accept(); setPhotoOpen(false); } catch (e) { if (e instanceof ApiError && (e.status >= 400 && e.status < 500 && e.detail.code !== 'IDEMPOTENCY_CONFLICT' || e.detail.code === 'GENERATION_UNAVAILABLE')) remember(null); setError((e as Error).message); } finally { guard.current = false; setBusy(false); } }
  async function recover() { if (!pending || guard.current) return; guard.current = true; setBusy(true); setError(''); try { await request<OutfitJob>(`/outfit-ai-jobs/by-request/${pending.key}`); await accept(); } catch (e) { setError(e instanceof ApiError && e.status === 404 ? '尚未找到已接受的提交，可以使用原提交键重新发送。' : (e as Error).message); } finally { guard.current = false; setBusy(false); } }
  function start(kind: 'EVALUATION' | 'IMAGE') { void send({ key: crypto.randomUUID(), outfitId: outfit.id, body: { kind, revision: outfit.revision, ...(kind === 'IMAGE' ? { personFileId: photo } : {}) } }); }
  const submissionFeedback = <>{error ? <Feedback type="error" title={error} /> : null}{pending ? <Feedback type="warning" title="提交结果待确认" description="已保留原提交键，请先找回任务，避免重复生成。" action={<Space wrap><Button loading={busy} onClick={() => void recover()}>找回任务</Button><Button disabled={busy} onClick={() => void send(pending)}>原键重发</Button></Space>} /> : null}</>;
  return <Card className="outfit-ai-section" title="AI 建议" extra={<Button onClick={()=>setHistoryOpen(true)}>生成历史</Button>}><Typography.Paragraph type="secondary">保留你选定的单品，分析配色与穿法。文字评价无需本人照片。</Typography.Paragraph>
    {latest && (isActive(latest.status) || latest.status==='UNKNOWN' || latest.errorMessage) && <Alert className="outfit-ai-task-alert" type={latest.errorMessage?'error':'info'} title={latest.errorMessage || (latest.status==='UNKNOWN'?'生成结果待确认':'正在处理，可离开页面，任务会继续执行。')} action={!processing && <Button onClick={()=>{setPage(1);setSelected(latest.taskId);setHistoryOpen(true);}}>查看任务</Button>}/>}
    {!processing && <Space wrap><Button loading={busy} disabled={!!pending} onClick={() => start('EVALUATION')}>评价这套搭配</Button><Button type="primary" disabled={busy || !!pending || outfit.items.some(i => i.missing)} onClick={() => setPhotoOpen(true)}>生成效果图</Button></Space>}
    {!historyOpen && submissionFeedback}
    {current.isError && <Feedback type="error" title={current.error.message} action={<Button onClick={()=>void current.refetch()}>重新加载建议</Button>}/>}{current.isPending && <Skeleton active/>}
    {evaluation?.result && <div className="outfit-current-advice"><Typography.Paragraph>{evaluation.result.summary}</Typography.Paragraph><Collapse items={[{key:'detail',label:'详细建议',children:<JobResult job={evaluation}/>}]}/></div>}
    <OutfitHistory accountId={accountId} outfit={outfit} open={historyOpen} onClose={() => setHistoryOpen(false)}
      jobs={query.data?.items ?? []} total={query.data?.total} page={page} onPage={setPage} selected={selected} onSelect={setSelected}
      currentImageTaskId={current.data?.image?.revision === outfit.revision && !current.data.image.stale ? current.data.image.taskId : undefined}
      loading={query.isPending} refreshing={query.isFetching} error={query.isError ? query.error.message : undefined} onRefresh={() => void query.refetch()}
      submissionFeedback={<>{error && <Alert type="error" showIcon title={error} />}{pending && <Alert type="warning" showIcon title="提交结果待确认" description="已保留原提交键，请先找回任务，避免重复生成。" action={<Space wrap><Button loading={busy} onClick={() => void recover()}>找回任务</Button><Button disabled={busy} onClick={() => void send(pending)}>原键重发</Button></Space>} />}</>} retryDisabled={busy || !!pending} onRetry={(job, mode) => void send({ key: crypto.randomUUID(), outfitId: outfit.id, sourceId: job.taskId, body: { mode } })} />
    <Modal open={photoOpen} title="生成这套搭配的上身效果图" onCancel={() => setPhotoOpen(false)} confirmLoading={busy} okText="确认生成" okButtonProps={{ disabled: !photo || !!pending }} onOk={() => start('IMAGE')}><p>将基于当前组合重新评价并生成效果图。请确认本人照片，基础穿搭不完整时会提示补齐，不会自行换衣。</p>{photo ? <div className="generation-person-preview"><PrivateImage hideRefresh accountId={accountId} fileId={photo} alt="选中的本人照片" /></div> : null}<Button onClick={() => setPicker(true)}>选择本人照片</Button><Button href="/app/profile?tab=photos">管理 / 上传照片</Button></Modal>{picker ? <PhotoPicker accountId={accountId} value={photo} onSelect={setPhoto} onClose={() => setPicker(false)} /> : null}
  </Card>;
}

function JobResult({job}:{job:OutfitJob}) { const result=job.result; if(!result)return null; return <div className="task-text"><Typography.Paragraph>{result.designReason}</Typography.Paragraph>{result.colorAdvice && <Typography.Paragraph>配色建议：{result.colorAdvice}</Typography.Paragraph>}{result.wearingAdvice && <Typography.Paragraph>穿法建议：{result.wearingAdvice}</Typography.Paragraph>}{result.items.map((item,i)=><Typography.Paragraph key={i}><strong>{item.dressName}</strong>：{item.wearingMethod || item.matchReason}</Typography.Paragraph>)}{result.notices?.map((n,i)=><Alert key={i} type={n.severity==='WARNING'?'warning':'info'} title={n.message}/>)}{result.illustrativeShoes && <Alert type="info" title="鞋子为 AI 生成示意，非衣橱单品" description={result.illustrativeShoes.description}/>}</div>; }
