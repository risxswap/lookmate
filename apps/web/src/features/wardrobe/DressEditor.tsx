import { Feedback } from '../../components/Feedback';
import { useState } from 'react';
import { Checkbox, Form, Input, Modal, Select } from 'antd';
import { ApiError } from '../../api/client';
import { countText, trimText, seasons, useWardrobeWrite, type Category, type Dress } from './queries';
import { ImageUpload, usableImage, type ImageDraft } from './ImageUpload';
interface Values { name: string; categoryId: string; color?: string; seasons: string[]; notes?: string }
const limit = (max: number, required = false) => ({ validator: (_: unknown, value?: string) => (!required || !!trimText(value ?? '')) && countText(required ? trimText(value ?? '') : value ?? '') <= max ? Promise.resolve() : Promise.reject(new Error(required ? `请输入 1–${max} 个字符` : `最多 ${max} 个字符`)) });
export function DressEditor({ accountId, categories, dress, initialCategoryId, onClose }: { accountId: string; categories: Category[]; dress?: Dress; initialCategoryId?: string; onClose: () => void }) {
  const [form] = Form.useForm<Values>();
  const write = useWardrobeWrite(accountId);
  const [images, setImages] = useState<ImageDraft[]>(dress?.images.map((image, index) => ({ key: image.id, imageId: image.id, fileId: image.fileId, name: `${dress.name} · 图片 ${index + 1}`, status: 'READY' })) ?? []);
  const [imageError, setImageError] = useState('');
  const submit = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    if (!images.length || !images.every(usableImage)) { setImageError('请至少添加一张图片，并等待上传完成；上传失败时请按图片提示重试。'); return; }
    setImageError('');
    const body: Record<string, unknown> = {};
    for (const key of ['name', 'categoryId', 'color', 'seasons', 'notes'] as const) {
      if (!dress || form.isFieldTouched(key)) body[key] = key === 'color' || key === 'notes' ? values[key] || null : values[key];
    }
    const imageValues = images.map(image => image.imageId ? { imageId: image.imageId } : { fileId: image.fileId });
    if (!dress || images.length !== dress.images.length || images.some((image, i) => image.imageId !== dress.images[i]?.id)) body.images = imageValues;
    write.mutate({ path: dress ? `/dresses/${dress.id}` : '/dresses', method: dress ? 'PATCH' : 'POST', body }, {
      onSuccess: onClose,
      onError: error => { if (error instanceof ApiError && error.detail.fieldErrors) form.setFields(error.detail.fieldErrors.filter(f => ['name', 'categoryId', 'color', 'seasons', 'notes'].includes(f.field)).map(f => ({ name: f.field as keyof Values, errors: [f.message] }))); },
    });
  };
  return <Modal title={dress ? '编辑单品' : '添加单品'} open width={800} onCancel={onClose} onOk={() => void submit()} okText="保存单品" cancelText="取消" confirmLoading={write.isPending} cancelButtonProps={{ disabled: write.isPending }} closable={!write.isPending} keyboard={!write.isPending} maskClosable={false} destroyOnHidden>
    {write.isError ? <Feedback eventKey={write.error} type="error" title={write.error.message} description="你的输入已保留，请检查后重试。" /> : null}
    <Form form={form} layout="vertical" disabled={write.isPending} initialValues={{ name: dress?.name ?? '', categoryId: dress?.categoryId ?? initialCategoryId, color: dress?.color ?? '', seasons: dress?.seasons ?? [], notes: dress?.notes ?? '' }}>
      <Form.Item label="单品图片" required validateStatus={imageError ? 'error' : undefined} help={imageError || undefined}><ImageUpload accountId={accountId} items={images} setItems={setImages} disabled={write.isPending} /></Form.Item>
      <Form.Item label="单品名称" name="name" required rules={[limit(100, true)]}><Input placeholder="例如：米白色针织开衫" /></Form.Item>
      <div className="dress-form-columns"><Form.Item label="分类" name="categoryId" rules={[{ required: true, message: '请选择分类' }]}><Select options={categories.map(c => ({ value: c.id, label: c.name }))} /></Form.Item><Form.Item label="颜色说明" name="color" rules={[limit(100)]}><Input placeholder="可选" /></Form.Item></div>
      <Form.Item label="适用季节" name="seasons" extra="不选择表示不限季节。"><Checkbox.Group options={seasons} /></Form.Item>
      <Form.Item label="备注" name="notes" rules={[limit(1000)]}><Input.TextArea rows={3} /></Form.Item>
    </Form>
  </Modal>;
}
