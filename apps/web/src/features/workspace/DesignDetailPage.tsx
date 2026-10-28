import { useState } from 'react';
import { Alert, Button, Modal, Descriptions, Drawer, Radio, Result, Skeleton, Space, Typography } from 'antd';
import { Feedback } from '../../components/Feedback';
import { PageHeading } from '../../components/PageHeading';
import { OutfitJobRetry } from '../outfits/OutfitJobRetry';
import { useOutfitWrite } from '../outfits/api';
import { navigate } from '../../app/navigation';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { RetryActions } from '../generation/RetryActions';
import { ContextDetails } from '../generation/PreviewDetails';
import { RecordActions } from '../designs/RecordActions';
import { FavoriteAction } from '../designs/FavoriteAction';
import { ApiError } from '../../api/client';
import { isActive, useDesignDetail, type DesignDetail, type TaskStatus } from './queries';
import { designTypeName, QueryFailure, StatusTag, TaskMetadata, TaskNotice } from './TaskViews';
import './design-studio-detail.css';

const stages = ['QUEUED', 'PLANNING', 'GENERATING', 'SAVING'] as const;
const stageNames = ['等待开始', '构思方案', '生成效果图', '保存结果'];
const stageCopy: Record<TaskStatus, string> = {
  QUEUED: '设计已提交，正在等待开始。',
  PLANNING: '正在结合你的照片和要求，构思这次设计。',
  GENERATING: '方案已就绪，正在生成你的效果图。',
  SAVING: '正在保存结果，完成后就能在这里查看。',
  SUCCEEDED: '看看这次设计，找到适合自己的新灵感。',
  FAILED: '本次设计未能完成，可查看原因和恢复方式。',
  UNKNOWN: '生成结果仍待确认，请稍后刷新查看。',
};

function StudioProgress({ task }: { task: DesignDetail }) {
  const active = isActive(task.status);
  const visibleStages = task.jobKind === 'EVALUATION' ? stages.filter(stage => stage !== 'GENERATING') : stages;
  const current = visibleStages.findIndex(stage => stage === task.status);
  const description = task.jobKind === 'EVALUATION' && task.status === 'SUCCEEDED'
    ? '文字评价已完成，可以查看搭配建议。'
    : task.jobKind === 'EVALUATION' && task.status === 'PLANNING'
      ? '正在结合所选单品和要求，分析这套搭配。'
      : stageCopy[task.status];
  return <div className="studio-detail-progress" aria-live="polite">
    {task.status !== 'SUCCEEDED' ? <p>{description}</p> : null}
    {active ? <><ol className="studio-detail-stages" aria-label="设计进度">{visibleStages.map((stage, index) => <li key={stage} className={index === current ? 'is-current' : index < current ? 'is-complete' : ''} aria-current={index === current ? 'step' : undefined}><span aria-hidden="true">{index < current ? '✓' : index + 1}</span>{stageNames[stages.indexOf(stage)]}</li>)}</ol><Typography.Text type="secondary">可以离开此页，稍后从设计记录继续查看。</Typography.Text></> : null}
  </div>;
}

function InputSnapshot({ accountId, task }: { accountId: string; task: DesignDetail }) {
  const input = task.inputSummary;
  if (!input) return null;
  return <><Typography.Paragraph className="task-text">{input.request.requirements || '没有额外设计要求'}</Typography.Paragraph><Descriptions column={1} size="small" items={[
    { key: 'occasion', label: '场合', children: input.request.occasion || '日常' },
    { key: 'style', label: '风格', children: input.request.style || '参考已有偏好' },
    { key: 'weather', label: '天气', children: input.request.weatherNote || '未提供' },
    { key: 'required', label: '必穿', children: input.requiredDresses?.map(d => d.dressName).join('、') || '未指定' },
    { key: 'overrides', label: '本次允许的例外', children: input.constraintOverrides?.map(v => v.originalText).join('；') || '无' },
  ]} />{input.personalContext ? <ContextDetails value={input.personalContext} /> : null}{input.personPhoto?.fileId ? <div className="studio-detail-snapshot-photo"><PrivateImage accountId={accountId} fileId={input.personPhoto.fileId} alt="提交时使用的本人照片" hideRefresh /></div> : null}</>;
}

export function DesignDetailPage({ accountId, id }: { accountId: string; id: string }) {
  const outfitWrite = useOutfitWrite(accountId);
  const query = useDesignDetail(accountId, id);
  const [imageChoice, setImageChoice] = useState<{ taskId: string; kind: 'original' | 'result' } | null>(null);
  const [inputDrawerOpen, setInputDrawerOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const task = query.data;
  const result = task?.result;
  const originalId = task?.inputSummary?.personPhoto?.fileId;
  const outputId = task?.outputFileId;
  const imageKind = imageChoice?.taskId === id && (imageChoice.kind === 'original' ? originalId : outputId) ? imageChoice.kind : outputId ? 'result' : 'original';
  const imageId = outputId ? imageKind === 'result' ? outputId : originalId : null;
  const unavailable = query.error instanceof ApiError && query.error.status === 404;
  const canSaveOutfit = task?.status === 'SUCCEEDED' && !!result?.items.length && !task.outfitId;
  return <div className="design-studio-detail">
    <PageHeading title={task?.title || "本次形象设计"} action={<Space>{task ? <StatusTag status={task.status} /> : null}<Button size="small" loading={query.isFetching} onClick={() => void query.refetch()}>刷新状态</Button>{task ? <RecordActions accountId={accountId} task={task} detail onViewMetadata={() => setMetadataOpen(true)} /> : null}</Space>} />
    {outfitWrite.isError ? <Feedback eventKey={outfitWrite.error} type="error" title={outfitWrite.error.message} /> : null}
    {unavailable ? <Result status="404" title="设计记录不可用" subTitle="记录不存在或已不可访问。" extra={<Button href="/app">返回工作台</Button>} /> : <>
      {query.isError ? <QueryFailure error={query.error} stale={!!task} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
      {query.isPending ? <div className="studio-detail-loading"><Skeleton active paragraph={{ rows: 7 }} /><Skeleton.Image active /></div> : null}
      {task ? <div className={`studio-detail-layout${outputId ? "" : " without-output"}`}>
        <section className="studio-detail-request" aria-label="本次设计要求">
          <div className="studio-detail-request-copy"><Space wrap><span>{designTypeName(task.designType)}</span>{task.inputSummary?.request.occasion ? <span>· {task.inputSummary.request.occasion}</span> : null}{task.inputSummary?.request.style ? <span>· {task.inputSummary.request.style}</span> : null}</Space><Typography.Paragraph ellipsis={{ rows: 1, expandable: true, symbol: "展开" }}>{task.inputSummary?.request.requirements || '按提交时的资料与偏好设计'}</Typography.Paragraph></div>
          <div className="studio-detail-references">
            {originalId ? <figure><PrivateImage accountId={accountId} fileId={originalId} thumbnail hideRefresh preview alt="本次参考照片" /><figcaption>参考照片</figcaption></figure> : null}
            {task.inputSummary?.requiredDresses?.map(dress => <figure key={dress.dressId}>{dress.imageFileIds?.[0] ? <PrivateImage accountId={accountId} fileId={dress.imageFileIds[0]} thumbnail hideRefresh preview alt={dress.dressName} /> : null}<figcaption>必穿：{dress.dressName}</figcaption></figure>)}
          </div>
          {task.inputSummary ? <Button type="link" onClick={() => setInputDrawerOpen(true)}>查看设计依据</Button> : null}
        </section>
        {task.status !== 'SUCCEEDED' ? <section className="studio-detail-status" aria-label="任务进度与恢复">
          <StudioProgress task={task} />
          <TaskNotice task={task} />
          {task.status === 'FAILED' || task.status === 'UNKNOWN' ? <><p>{result ? '已完成的文字方案保留在下方。' : '尚无已保存的文字方案。'}</p>{task.outfitId ? <OutfitJobRetry key={task.id} accountId={accountId} task={task} /> : <RetryActions key={task.id} accountId={accountId} task={task} />}</> : null}
        </section> : null}
        <Drawer title="本次完整要求" open={inputDrawerOpen} onClose={() => setInputDrawerOpen(false)}><InputSnapshot accountId={accountId} task={task} /></Drawer>
        <section className="studio-detail-content" aria-label="设计方案与操作">
          <div className="studio-detail-summary">
            {!outputId && (task.jobKind === 'EVALUATION' || task.status === 'SUCCEEDED') ? <Typography.Paragraph type="secondary">{task.jobKind === 'EVALUATION' ? '本次为文字评价，无需效果图。' : '这条历史记录暂无可访问的效果图。'}</Typography.Paragraph> : null}
            <Typography.Title level={2}>{result?.title || task.title || (task.jobKind === 'EVALUATION' ? '你的搭配评价' : '你的形象设计')}</Typography.Title>
            {result ? <>
              {task.status !== 'SUCCEEDED' ? <Typography.Paragraph type="secondary" className="studio-detail-partial">文字方案已保存，{task.jobKind === 'EVALUATION' ? '任务尚未完成。' : '效果图尚未完成。'}</Typography.Paragraph> : null}
              <Typography.Paragraph className="task-text studio-detail-summary-copy">{result.summary}</Typography.Paragraph>
              <div className="studio-detail-facts">{result.style ? <div><span>风格</span><strong>{result.style}</strong></div> : null}{result.occasion ? <div><span>适用场合</span><strong>{result.occasion}</strong></div> : null}</div>
              {result.novelty?.description || result.novelty?.explanation ? <Typography.Paragraph className="task-text" type="secondary">{result.novelty.description || result.novelty.explanation}</Typography.Paragraph> : null}
            </> : <Typography.Paragraph type="secondary">{isActive(task.status) ? '方案完成后，会在这里展示设计思路和具体建议。' : '暂无已保存的方案文字。'}</Typography.Paragraph>}
          </div>
        <section className="studio-detail-advice" aria-label="具体设计建议">
          {result?.notices?.filter(notice => notice.placement !== 'NEAR_IMAGE').map((notice, index) => <Alert className="studio-detail-notice" key={`${notice.code}-${index}`} showIcon type={notice.severity === 'WARNING' ? 'warning' : 'info'} title={notice.message} />)}
          {result?.items.length ? <section className="studio-detail-items"><div className="studio-detail-section-heading"><h3>这次的穿搭</h3><span>{result.items.length} 件单品</span></div>{result.wearingAdvice ? <Typography.Paragraph className="task-text">{result.wearingAdvice}</Typography.Paragraph> : null}{result.items.map((item, index) => <article className="studio-detail-item" key={`${item.dressId}-${index}`}>
            <div className="studio-detail-item-images">{item.imageFileIds?.length ? item.imageFileIds.map(fileId => <PrivateImage key={fileId} accountId={accountId} fileId={fileId} thumbnail hideRefresh alt={item.dressName} preview />) : <span className="studio-detail-item-placeholder">暂无图片</span>}</div>
            <div><span className="studio-detail-item-category">{item.categoryName}</span><h4>{item.dressName}</h4><Typography.Paragraph className="task-text">{item.wearingMethod || '暂无具体穿法建议'}</Typography.Paragraph>{item.matchReason ? <Typography.Paragraph className="task-text studio-detail-item-reason" ellipsis={{ rows: 1, expandable: true, symbol: "展开理由" }}>搭配理由：{item.matchReason}</Typography.Paragraph> : null}</div>
          </article>)}</section> : null}
          <div className="studio-detail-core-advice">
            {result?.hairstyle ? <section><h3>发型 · {result.hairstyle.hairstyleName}</h3><p className="studio-detail-hair-points">{[['长度', result.hairstyle.lengthAdvice], ['刘海', result.hairstyle.bangsAdvice], ['分缝', result.hairstyle.partingAdvice], ['质感', result.hairstyle.textureAdvice], ['发色', result.hairstyle.hairColorAdvice]].filter(([, value]) => value).map(([label, value]) => <span key={label}><small>{label}</small>{value}</span>)}</p><details><summary>日常打理</summary><p>{result.hairstyle.careAdvice || '暂无打理建议'}</p></details></section> : null}
            {result ? <section><Typography.Paragraph ellipsis={{ rows: 2, expandable: true, symbol: '完整理由' }}>{result.designReason}</Typography.Paragraph><details><summary>设计说明与配色</summary><p>{result.colorAdvice || '暂无配色建议'}</p>{!result.items.length && result.wearingAdvice ? <p>{result.wearingAdvice}</p> : null}</details></section> : null}
          </div>
        </section>
          <div className="studio-detail-actions">
            <Space wrap><FavoriteAction accountId={accountId} task={task} />{canSaveOutfit ? <Button type="primary" loading={outfitWrite.isPending} onClick={() => { void outfitWrite.mutateAsync({ path: `/outfits/from-design/${id}`, method: 'POST', body: {} }).then(outfit => navigate(new URL(`/app/wardrobe/outfits/${outfit.id}`, window.location.origin))).catch(() => {}); }}>存为常用搭配</Button> : null}</Space>
            {task.status !== 'FAILED' && task.status !== 'UNKNOWN' ? task.outfitId ? <OutfitJobRetry key={task.id} accountId={accountId} task={task} /> : <RetryActions key={task.id} accountId={accountId} task={task} /> : null}
          </div>
        </section>
        <section className={`studio-detail-visual${outputId ? "" : " notices-only"}`} aria-label="设计图片">
          {outputId ? <>
          <div className="studio-detail-image-heading"><div><h2>{imageKind === 'result' ? '设计效果图' : '本次原照片'}</h2></div>
            {originalId && outputId ? <Radio.Group size="small" optionType="button" buttonStyle="solid" aria-label="切换设计图片" value={imageKind} onChange={event => setImageChoice({ taskId: id, kind: event.target.value })} options={[{ label: '原照片', value: 'original' }, { label: '效果图', value: 'result' }]} /> : null}
          </div>
          <div className={`studio-detail-image-stage${imageId ? '' : ' is-empty'}`}>
            {imageId ? <PrivateImage key={imageId} accountId={accountId} fileId={imageId} alt={imageKind === 'result' ? '本次设计效果图' : '本次设计使用的原照片'} hideRefresh /> : null}
          </div>
          {outputId ? <Typography.Paragraph className="studio-detail-image-caption" type="secondary">{imageKind === 'result' ? '效果图展示设计意图，不代表真实合身或服装性能验证。' : '这是提交时使用的原照片。'}</Typography.Paragraph> : null}
          </> : null}
          <div className="studio-detail-image-notices">
            {result?.matchLevel === 'APPROXIMATE' ? <Alert showIcon type="warning" title="本方案尽量接近你的目标，请留意适用局限" /> : null}
            {result?.notices?.filter(notice => notice.placement === 'NEAR_IMAGE').map((notice, index) => <Alert showIcon key={`${notice.code}-${index}`} type={notice.severity === 'WARNING' ? 'warning' : 'info'} title={notice.message} />)}
            {result?.illustrativeShoes && !result.notices?.some(notice => notice.code === 'ILLUSTRATIVE_SHOES' && notice.placement === 'NEAR_IMAGE') ? <Alert showIcon type="info" title="鞋子为 AI 生成示意，非衣橱单品" description={result.illustrativeShoes.description} /> : null}
          </div>
        </section>
        <Modal title="任务信息" open={metadataOpen} onCancel={() => setMetadataOpen(false)} footer={null}>
          <TaskMetadata task={task} />
        </Modal>
      </div> : null}
    </>}
  </div>;
}
