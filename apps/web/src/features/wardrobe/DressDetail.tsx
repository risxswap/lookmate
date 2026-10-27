import { Feedback } from '../../components/Feedback';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Modal, Popconfirm, Skeleton, Space, Tag, Typography } from 'antd';
import { QueryFailure } from '../workspace/TaskViews';
import { DressEditor } from './DressEditor';
import { FeatureEditor, featureText } from './FeatureEditor';
import { PrivateImage } from './PrivateImage';
import { featureLabels, recognitionLabels, seasons, useDress, useWardrobeWrite, type Category, type Dress, type DressImage, type FeatureKey, type Features } from './queries';
import './dress-detail.css';

// Empty nested detail values should not turn into repeated “unknown” rows.
function populatedFeature(value: Features[FeatureKey]): Features[FeatureKey] {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (Array.isArray(value)) return value.some(v => v.trim()) ? value.filter(v => v.trim()) : undefined;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v?.trim());
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return undefined;
}
type Editor = { kind: 'dress'; snapshot: Dress } | { kind: 'feature'; snapshot: DressImage };
export function DressDetail({ accountId, id, categories, onClose }: { accountId: string; id: string; categories: Category[]; onClose: () => void }) {
  const query = useDress(accountId, id);
  const write = useWardrobeWrite(accountId);
  const [editor, setEditor] = useState<Editor>();
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const content = contentRef.current;
    if (content?.parentElement) content.parentElement.scrollTop = 0;
    content?.focus({ preventScroll: true });
  }, [editor?.kind]);
  const [editorBusy, setEditorBusy] = useState(false);
  const [selectedImageId, setSelectedImageId] = useState<string>();
  const dress = query.data;
  const recognition = dress?.recognition;
  const retryable = recognition && ['FAILED', 'UNKNOWN'].includes(recognition.status);
  const image = dress?.images.find(item => item.id === selectedImageId) ?? dress?.images[0];
  useEffect(() => { if (image) setSelectedImageId(image.id); }, [image?.id]);
  const featureItems = (Object.keys(featureLabels) as FeatureKey[]).flatMap(key => {
    const value = populatedFeature(image?.effectiveFeatures?.[key]);
    return value === undefined ? [] : [{ key, label: featureLabels[key], text: featureText(value), revised: !!image?.manualFeatures && Object.hasOwn(image.manualFeatures, key) }];
  });
  const clearedFeatures = (Object.keys(featureLabels) as FeatureKey[]).filter(key => image?.manualFeatures && Object.hasOwn(image.manualFeatures, key) && populatedFeature(image.manualFeatures[key]) === undefined);
  const leaveEditor = () => { setEditor(undefined); setEditorBusy(false); };
  const footer = <div className="dress-detail-footer"><Space><Button onClick={onClose} disabled={write.isPending}>关闭</Button><Button type="primary" disabled={!dress || write.isPending || !categories.length} onClick={() => { if (dress) setEditor({ kind: 'dress', snapshot: dress }); }}>编辑单品</Button></Space></div>;
  return <Modal open className={`dress-detail-modal${editor ? ' is-editing' : ' is-viewing'}`} style={{ top: 24 }} styles={{ body: editor ? { maxHeight: 'calc(100dvh - 160px)', overflowY: 'auto' } : { height: 'min(680px, calc(100dvh - 168px))', overflow: 'hidden' } }} title={editor?.kind === 'dress' ? '编辑单品' : editor?.kind === 'feature' ? '修订图片特征' : '单品详情'} width={editor ? 800 : 1040} onCancel={editor ? leaveEditor : onClose} footer={editor ? null : footer} closable={!editorBusy && !write.isPending} keyboard={!editorBusy && !write.isPending} maskClosable={false}>
    <div ref={contentRef} className="dress-detail-content" tabIndex={-1} role="region" aria-label={editor?.kind === 'dress' ? '编辑单品' : editor?.kind === 'feature' ? '修订图片特征' : '单品详情'}>
    {editor?.kind === 'dress' ? <DressEditor embedded accountId={accountId} categories={categories} dress={editor.snapshot} onClose={leaveEditor} onBusyChange={setEditorBusy} /> : editor?.kind === 'feature' ? <FeatureEditor embedded accountId={accountId} dressId={id} image={editor.snapshot} onClose={leaveEditor} onBusyChange={setEditorBusy} /> : <div className="dress-detail-view">
      {query.isError ? <QueryFailure error={query.error} stale={!!dress} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
      {query.isPending ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
      {write.isError ? <Feedback eventKey={write.error} type="error" title={write.error.message} /> : null}
      {dress ? <div className="dress-detail-layout">
        <section className="dress-detail-gallery" aria-label="单品图片">
          {image ? <><div className="dress-detail-main-image"><PrivateImage key={image.fileId} accountId={accountId} fileId={image.fileId} alt={dress.name} hideRefresh /></div><div className="dress-detail-thumbnails" aria-label="选择图片">{dress.images.map((item, index) => <div key={item.id} className={`dress-detail-thumbnail${item.id === image.id ? ' is-selected' : ''}`}><PrivateImage accountId={accountId} fileId={item.fileId} alt={index === 0 ? '封面图片' : '单品图片'} thumbnail compact preview={false} /><Button type="text" className="dress-thumbnail-select" aria-label={`选择第 ${index + 1} 张图片${index === 0 ? '（封面）' : ''}`} aria-pressed={item.id === image.id} onClick={() => setSelectedImageId(item.id)}>{index === 0 ? <span>封面</span> : null}</Button></div>)}</div></> : <Empty description="暂无图片" />}
        </section>
        <section className="dress-detail-information" aria-label="单品资料">
          <div className="dress-detail-summary">
            <Typography.Title level={4} className="dress-detail-name" tabIndex={0}>{dress.name}</Typography.Title>
            <dl className="dress-detail-metadata"><div><dt>分类</dt><dd tabIndex={0}>{categories.find(c => c.id === dress.categoryId)?.name ?? '分类读取中'}</dd></div><div><dt>适用季节</dt><dd tabIndex={0}>{dress.seasons.length ? dress.seasons.map(s => seasons.find(v => v.value === s)?.label ?? s).join('、') : '不限季节'}</dd></div>{dress.color ? <div><dt>颜色说明</dt><dd tabIndex={0}>{dress.color}</dd></div> : null}{dress.notes ? <div><dt>备注</dt><dd tabIndex={0}>{dress.notes}</dd></div> : null}</dl>
          </div>
          <div className="recognition-notice" tabIndex={0}>
            {recognition && recognition.status !== 'SUCCEEDED' ? <Alert type={retryable ? 'warning' : 'info'} title={recognitionLabels[recognition.status] ?? recognition.status} description={<>{recognition.errorMessage ? <div className="task-text">{recognition.errorMessage}</div> : null}{recognition.status === 'UNKNOWN' ? <div>此状态不会自动轮询，请先关闭并重新打开详情核对当前结果；重试可能再次调用识别服务。</div> : null}</>} /> : <Tag>{recognition ? '识别完成' : '尚无识别任务'}</Tag>}
            {retryable ? <Space wrap className="dress-recognition-actions"><Popconfirm title={recognition.status === 'UNKNOWN' ? '确认重新识别？' : '重新识别这些图片？'} description={recognition.status === 'UNKNOWN' ? '上次请求结果尚未确认，重试可能再次调用识别服务。请先关闭并重新打开详情核对当前状态。' : '重新识别不会覆盖你的人工修订。'} okText="确认重试" cancelText="取消" onConfirm={() => write.mutate({ path: `/dresses/${id}/recognition-retry`, method: 'POST', body: { recognitionId: recognition.id, ...(recognition.status === 'UNKNOWN' ? { confirmUnknown: true } : {}) } })}><Button loading={write.isPending}>重试识别</Button></Popconfirm></Space> : null}
          </div>
          {image && !image.aiCurrent && image.recognitionId !== null ? <div className="dress-detail-stale" tabIndex={0}><Alert type="info" title="当前图片的旧识别结果已过期" description="旧图片组合的识别结果不再采用，当前只使用人工特征。" /></div> : null}
          {image ? <section key={image.id} className="dress-detail-features" aria-label="图片特征"><div className="dress-detail-feature-heading"><Typography.Title level={5}>图片特征</Typography.Title><Button size="small" disabled={write.isPending} onClick={() => setEditor({ kind: 'feature', snapshot: image })}>修订特征</Button></div><div className="dress-feature-scroll" tabIndex={0} role="region" aria-label="图片特征内容">{featureItems.length ? <dl className="dress-feature-grid">{featureItems.map(item => <div key={item.key} className={`dress-feature-field dress-feature-${item.key}`}><dt>{item.label}{item.revised ? <Tag className="dress-feature-revised">已修订</Tag> : null}</dt><dd aria-label={`${item.label}内容`} className="dress-feature-value">{item.text}</dd></div>)}</dl> : <Typography.Paragraph type="secondary">暂无图片特征</Typography.Paragraph>}{clearedFeatures.length ? <Typography.Paragraph className="dress-feature-cleared" type="secondary">已修订为空：{clearedFeatures.map(key => featureLabels[key]).join('、')}</Typography.Paragraph> : null}</div></section> : null}
        </section>
      </div> : null}
    </div>}
    </div>
  </Modal>;
}
