import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal, Select, Typography } from 'antd';
import { ApiError, request } from '../../api/client';
import { countText, featureLabels, useWardrobeWrite, type Dress, type DressImage, type FeatureKey, type Features } from './queries';
const keys = Object.keys(featureLabels) as FeatureKey[];
const detailLabels = { neckline: '领口', sleeve: '袖型', pocket: '口袋', button: '纽扣' };
const views = [{ value: 'FRONT', label: '正面' }, { value: 'BACK', label: '背面' }, { value: 'SIDE', label: '侧面' }, { value: 'DETAIL', label: '细节' }, { value: 'OTHER', label: '其他' }];
type Mode = 'unchanged' | 'value' | 'null' | 'reset';
export function featureText(value: Features[FeatureKey]): string {
  if (value === null || value === undefined) return '未知';
  if (Array.isArray(value)) return value.join('、') || '未填写';
  if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${detailLabels[k as keyof typeof detailLabels] || k}：${v ?? '未知'}`).join('；');
  return views.find(v => v.value === value)?.label ?? value;
}
export function FeatureEditor({ accountId, dressId, image, onClose }: { accountId: string; dressId: string; image: DressImage; onClose: () => void }) {
  const write = useWardrobeWrite(accountId);
  const [version, setVersion] = useState(image.version);
  const [modes, setModes] = useState<Partial<Record<FeatureKey, Mode>>>({});
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
  function submit() {
    const manualFeatures: Features = {};
    const resetFeatureKeys: FeatureKey[] = [];
    for (const key of keys) {
      if (modes[key] === 'reset') resetFeatureKeys.push(key);
      if (modes[key] === 'null') manualFeatures[key] = null;
      if (modes[key] === 'value') {
        const value = values[key];
        if (key === 'viewType' && !views.some(v => v.value === value)) { setValidation('请选择拍摄视角。'); return; }
        if (key === 'colors' || key === 'styleTags') {
          if (!Array.isArray(value) || value.length > 20 || value.some(v => !v.trim() || countText(v) > 100)) { setValidation(`${featureLabels[key]}最多 20 项，每项 1–100 个字符。`); return; }
        } else if (key === 'details') {
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => v !== null && countText(v) > 255)) { setValidation('每项细节最多 255 个字符。'); return; }
        } else if (key !== 'viewType') {
          const max = { description: 4000, pattern: 255, fit: 100, materialDescription: 1000 }[key];
          if (typeof value !== 'string' || countText(value) > max) { setValidation(`${featureLabels[key]}最多 ${max} 个字符；设为未知请使用“清空为未知”。`); return; }
        }
        manualFeatures[key] = value;
      }
    }
    if (!Object.keys(manualFeatures).length && !resetFeatureKeys.length) { setValidation('请先选择要修改的特征。'); return; }
    setValidation('');
    write.mutate({ path: `/dresses/${dressId}/images/${image.id}`, method: 'PATCH', body: { version, manualFeatures, resetFeatureKeys } }, { onSuccess: onClose });
  }
  return <Modal open title="修订图片特征" width={760} onCancel={onClose} onOk={submit} okText="保存特征" cancelText="取消" confirmLoading={write.isPending} okButtonProps={{ disabled: refresh.isPending || removed || (conflict && version === (write.variables?.body as { version?: string })?.version) }} cancelButtonProps={{ disabled: busy }} closable={!busy} keyboard={!busy} maskClosable={false}>
    <Typography.Paragraph type="secondary">人工填写优先于识别结果。“清空为未知”会覆盖识别值；“恢复识别值”会删除该项人工覆盖。</Typography.Paragraph>
    {write.isError ? <Alert className="form-alert" type="error" showIcon title={write.error.message} description={conflict ? '输入已保留。先刷新最新版本，核对后再保存。' : '输入已保留，请检查后重试。'} action={conflict ? <Button loading={refresh.isPending} disabled={busy} onClick={() => refresh.mutate()}>刷新最新版本</Button> : undefined} /> : null}
    {refresh.isError ? <Alert className="form-alert" type="error" title={refresh.error.message} /> : null}
    {removed ? <Alert type="error" title="这张图片已被移除，请关闭编辑器并刷新单品。" /> : null}
    {refreshedImage ? <Alert className="form-alert" type="info" title="已读取最新版本，你的输入仍保留" description={<div>{keys.map(key => <div key={key}>{featureLabels[key]}：{featureText(refreshedImage.effectiveFeatures?.[key])}</div>)}</div>} /> : null}
    {validation ? <Alert className="form-alert" type="error" showIcon title={validation} /> : null}
    <Form layout="vertical" disabled={busy || removed}>{keys.map(key => {
      const mode = modes[key] ?? 'unchanged';
      const value = values[key];
      const setValue = (next: Features[FeatureKey]) => setValues(current => ({ ...current, [key]: next }));
      return <div key={key} className="feature-field"><Form.Item label={featureLabels[key]}><Select aria-label={`${featureLabels[key]}操作`} value={mode} options={[{ value: 'unchanged', label: '保持不变' }, { value: 'value', label: '人工填写' }, { value: 'null', label: '清空为未知' }, { value: 'reset', label: '恢复识别值' }]} onChange={next => { setModes(current => ({ ...current, [key]: next })); if (next === 'value' && value == null) setValue(key === 'colors' || key === 'styleTags' ? [] : key === 'details' ? {} : ''); }} /></Form.Item>
        <Typography.Paragraph type="secondary" className="feature-current">当前：{featureText(image.effectiveFeatures?.[key])}{image.manualFeatures && Object.hasOwn(image.manualFeatures, key) ? '（人工值）' : ''}</Typography.Paragraph>
        {mode === 'value' ? key === 'viewType' ? <Select aria-label="拍摄视角内容" options={views} value={typeof value === 'string' ? value : undefined} onChange={setValue} disabled={busy || removed} /> : key === 'colors' || key === 'styleTags' ? <Select aria-label={`${featureLabels[key]}内容`} mode="tags" tokenSeparators={[',', '，']} value={Array.isArray(value) ? value : []} onChange={setValue} disabled={busy || removed} placeholder="输入一项后按回车" /> : key === 'details' ? <div className="dress-form-columns">{Object.entries(detailLabels).map(([detail, label]) => <Form.Item label={label} key={detail}><Input aria-label={label} value={value && typeof value === 'object' && !Array.isArray(value) ? value[detail] ?? '' : ''} onChange={e => setValue({ ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}), [detail]: e.target.value || null })} /></Form.Item>)}</div> : <Input.TextArea aria-label={`${featureLabels[key]}内容`} rows={key === 'description' ? 3 : 2} value={typeof value === 'string' ? value : ''} onChange={e => setValue(e.target.value)} disabled={busy || removed} /> : null}
      </div>;
    })}</Form>
  </Modal>;
}
