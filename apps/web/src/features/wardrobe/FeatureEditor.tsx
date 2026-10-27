import { Feedback } from '../../components/Feedback';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Typography } from 'antd';
import { ApiError, request } from '../../api/client';
import { countText, featureLabels, useWardrobeWrite, type Dress, type DressImage, type FeatureKey, type Features } from './queries';
import './wardrobe-scrollbars.css';
const keys = Object.keys(featureLabels) as FeatureKey[];
const detailLabels = { neckline: '领口', sleeve: '袖型', pocket: '口袋', button: '纽扣' };
const views = [{ value: 'FRONT', label: '正面' }, { value: 'BACK', label: '背面' }, { value: 'SIDE', label: '侧面' }, { value: 'DETAIL', label: '细节' }, { value: 'OTHER', label: '其他' }];
function normalizedValue(key: FeatureKey, value: Features[FeatureKey]): Features[FeatureKey] {
  if (value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0)) return null;
  if (key === 'details' && typeof value === 'object' && !Array.isArray(value)) {
    const details = Object.fromEntries(Object.keys(detailLabels).map(detail => [detail, value[detail]?.trim() ? value[detail] : null]));
    return Object.values(details).some(v => v !== null) ? details : null;
  }
  return value;
}
export function featureText(value: Features[FeatureKey]): string {
  if (value === null || value === undefined) return '未知';
  if (Array.isArray(value)) return value.join('、') || '未填写';
  if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${detailLabels[k as keyof typeof detailLabels] || k}：${v ?? '未知'}`).join('；');
  return views.find(v => v.value === value)?.label ?? value;
}
export function FeatureEditor({ accountId, dressId, image, onClose }: { accountId: string; dressId: string; image: DressImage; onClose: () => void }) {
  const write = useWardrobeWrite(accountId);
  const [version, setVersion] = useState(image.version);
  const [values, setValues] = useState<Features>({ ...image.effectiveFeatures });
  const [validation, setValidation] = useState('');
  const refresh = useMutation({ retry: false, mutationFn: () => request<Dress>(`/dresses/${dressId}`), onSuccess: latest => {
    const current = latest.images.find(i => i.id === image.id);
    if (current) setVersion(current.version);
  } });
  const conflict = write.error instanceof ApiError && write.error.detail.code === 'VERSION_CONFLICT';
  const refreshedImage = refresh.data?.images.find(i => i.id === image.id);
  const removed = !!refresh.data && !refreshedImage;
  const busy = write.isPending || refresh.isPending;
  const changes: Features = {};
  for (const key of keys) {
    const next = normalizedValue(key, values[key]);
    if (JSON.stringify(next) !== JSON.stringify(normalizedValue(key, image.effectiveFeatures?.[key]))) changes[key] = next;
  }
  const cannotSave = busy || removed || !Object.keys(changes).length || (conflict && version === (write.variables?.body as { version?: string })?.version);
  function submit() {
    if (cannotSave) return;
    for (const key of Object.keys(changes) as FeatureKey[]) {
      const value = changes[key];
      if (value === null) continue;
      if (key === 'viewType' && !views.some(v => v.value === value)) { setValidation('请选择拍摄视角。'); return; }
      if (key === 'colors' || key === 'styleTags') {
        if (!Array.isArray(value) || value.length > 20 || value.some(v => !v.trim() || countText(v) > 100)) { setValidation(`${featureLabels[key]}最多 20 项，每项 1–100 个字符。`); return; }
      } else if (key === 'details') {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => v !== null && countText(v) > 255)) { setValidation('每项细节最多 255 个字符。'); return; }
      } else if (key !== 'viewType') {
        const max = { description: 4000, pattern: 255, fit: 100, materialDescription: 1000 }[key];
        if (typeof value !== 'string' || countText(value) > max) { setValidation(`${featureLabels[key]}最多 ${max} 个字符。`); return; }
      }
    }
    setValidation('');
    write.mutate({ path: `/dresses/${dressId}/images/${image.id}`, method: 'PATCH', body: { version, manualFeatures: changes } }, { onSuccess: onClose });
  }
  const content = <>
    <Typography.Paragraph type="secondary">直接修改需要调整的内容，保存后生效；清空内容表示未知。</Typography.Paragraph>
    {write.isError ? <Feedback eventKey={write.error} type="error" title={write.error.message} description={conflict ? '输入已保留。先刷新最新版本，核对后再保存。' : '输入已保留，请检查后重试。'} action={conflict ? <Button loading={refresh.isPending} disabled={busy} onClick={() => refresh.mutate()}>刷新最新版本</Button> : undefined} /> : null}
    {refresh.isError ? <Feedback eventKey={refresh.error} type="error" title={refresh.error.message} /> : null}
    {removed ? <Feedback type="error" title="这张图片已被移除，请关闭编辑器并刷新单品。" /> : null}
    {refreshedImage ? <Feedback type="info" title="已读取最新版本，你的输入仍保留" description={<div>{keys.map(key => <div key={key}>{featureLabels[key]}：{featureText(refreshedImage.effectiveFeatures?.[key])}</div>)}</div>} /> : null}
    {validation ? <Feedback type="error" title={validation} /> : null}
    <Form layout="vertical" disabled={busy || removed}>{keys.map(key => {
      const value = values[key];
      const setValue = (next: Features[FeatureKey]) => setValues(current => ({ ...current, [key]: next }));
      return <div key={key} className="feature-field"><Form.Item label={featureLabels[key]}>
        {key === 'viewType' ? <Select aria-label="拍摄视角内容" allowClear placeholder="请选择" options={views} value={typeof value === 'string' ? value : undefined} onChange={setValue} disabled={busy || removed} /> : key === 'colors' || key === 'styleTags' ? <Select aria-label={`${featureLabels[key]}内容`} mode="tags" allowClear tokenSeparators={[',', '，']} value={Array.isArray(value) ? value : []} onChange={setValue} disabled={busy || removed} placeholder="输入一项后按回车" /> : key === 'details' ? <div className="dress-form-columns">{Object.entries(detailLabels).map(([detail, label]) => <Form.Item label={label} key={detail}><Input aria-label={label} value={value && typeof value === 'object' && !Array.isArray(value) ? value[detail] ?? '' : ''} onChange={e => setValue({ ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}), [detail]: e.target.value || null })} /></Form.Item>)}</div> : <Input.TextArea aria-label={`${featureLabels[key]}内容`} rows={key === 'description' ? 3 : 2} value={typeof value === 'string' ? value : ''} onChange={e => setValue(e.target.value)} disabled={busy || removed} />}
      </Form.Item></div>;
    })}</Form>
  </>;
  return <Modal zIndex={1100} className="wardrobe-editor-modal" open title="编辑特征" width={760} style={{ top: 24 }} styles={{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto', padding: '8px 12px 16px 4px' } }} onCancel={onClose} onOk={submit} okText="保存特征" cancelText="取消" confirmLoading={write.isPending} okButtonProps={{ disabled: cannotSave }} cancelButtonProps={{ disabled: busy }} closable={!busy} keyboard={!busy} maskClosable={false}>{content}</Modal>;
}
