import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Popconfirm, Skeleton, Space, Tag, Typography } from 'antd';
import { QueryFailure } from '../workspace/TaskViews';
import { DressEditor } from './DressEditor';
import { FeatureEditor, featureText } from './FeatureEditor';
import { PrivateImage } from './PrivateImage';
import { featureLabels, recognitionLabels, seasons, useDress, useWardrobeWrite, type Category, type DressImage, type FeatureKey } from './queries';
export function DressDetail({ accountId, id, categories, onClose }: { accountId: string; id: string; categories: Category[]; onClose: () => void }) {
  const query = useDress(accountId, id);
  const write = useWardrobeWrite(accountId);
  const [editing, setEditing] = useState(false);
  const [featureImage, setFeatureImage] = useState<DressImage>();
  const dress = query.data;
  const recognition = dress?.recognition;
  const retryable = recognition && ['FAILED', 'UNKNOWN'].includes(recognition.status);
  return <><Modal open title={dress?.name ?? '单品详情'} width={1000} onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>} maskClosable={false}>
    {query.isError ? <QueryFailure error={query.error} stale={!!dress} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
    {query.isPending ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
    {write.isError ? <Alert className="form-alert" type="error" showIcon title={write.error.message} /> : null}
    {dress ? <><Space wrap className="dress-detail-actions"><Button type="primary" disabled={write.isPending || !categories.length} onClick={() => setEditing(true)}>编辑单品</Button><Button loading={query.isFetching} onClick={() => void query.refetch()}>刷新单品</Button><Popconfirm title="删除这件单品？" description="将从衣橱移除，历史设计记录仍会保留。" okText="删除" cancelText="取消" onConfirm={() => write.mutate({ path: `/dresses/${id}`, method: 'DELETE' }, { onSuccess: onClose })}><Button danger loading={write.isPending}>删除单品</Button></Popconfirm></Space>
      <Descriptions column={2} items={[{ key: 'category', label: '分类', children: categories.find(c => c.id === dress.categoryId)?.name ?? '分类读取中' }, { key: 'color', label: '颜色', children: dress.color || '未填写' }, { key: 'seasons', label: '适用季节', children: dress.seasons.length ? dress.seasons.map(s => seasons.find(v => v.value === s)?.label ?? s).join('、') : '不限季节' }, { key: 'notes', label: '备注', children: <span className="task-text">{dress.notes || '未填写'}</span> }]} />
      <div className="recognition-notice"><Space wrap><Tag>{recognition ? recognitionLabels[recognition.status] ?? recognition.status : '尚无识别任务'}</Tag>{retryable ? <Popconfirm title={recognition.status === 'UNKNOWN' ? '确认重新识别？' : '重新识别这些图片？'} description={recognition.status === 'UNKNOWN' ? '上次请求结果尚未确认，重试可能再次调用识别服务。请先刷新单品确认当前状态。' : '重新识别不会覆盖你的人工修订。'} okText="确认重试" cancelText="取消" onConfirm={() => write.mutate({ path: `/dresses/${id}/recognition-retry`, method: 'POST', body: { recognitionId: recognition.id, ...(recognition.status === 'UNKNOWN' ? { confirmUnknown: true } : {}) } })}><Button loading={write.isPending}>重试识别</Button></Popconfirm> : null}</Space>{recognition?.errorMessage ? <Typography.Paragraph type="secondary">{recognition.errorMessage}</Typography.Paragraph> : null}{recognition?.status === 'UNKNOWN' ? <Typography.Paragraph type="secondary">此状态不会自动轮询，可手动刷新查看最新结果。</Typography.Paragraph> : null}</div>
      <div className="dress-detail-images">{dress.images.map((image, index) => <Card key={image.id} title={index === 0 ? '封面图片' : `图片 ${index + 1}`} extra={<Button onClick={() => setFeatureImage(image)}>修订特征</Button>}><PrivateImage accountId={accountId} fileId={image.fileId} alt={`${dress.name} · 图片 ${index + 1}`} />{!image.aiCurrent && image.recognitionId !== null ? <Alert className="form-alert" type="info" title="旧图片组合的识别结果已过期，当前只采用人工特征。" /> : null}<Descriptions size="small" column={1} items={(Object.keys(featureLabels) as FeatureKey[]).map(key => ({ key, label: featureLabels[key], children: <span className="task-text">{featureText(image.effectiveFeatures?.[key])}</span> }))} /></Card>)}</div>
    </> : null}
  </Modal>{editing && dress ? <DressEditor accountId={accountId} categories={categories} dress={dress} onClose={() => setEditing(false)} /> : null}{featureImage ? <FeatureEditor accountId={accountId} dressId={id} image={featureImage} onClose={() => setFeatureImage(undefined)} /> : null}</>;
}
