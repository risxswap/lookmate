import { Feedback } from '../../components/Feedback';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { Button, Image, Space, Tag, Typography } from 'antd';
import { ApiError, request } from '../../api/client';
import type { FileAsset } from './queries';
import { PrivateImage } from './PrivateImage';
export interface ImageDraft { key: string; imageId?: string; fileId?: string; name: string; status: string; error?: string; completePending?: boolean; previewUrl?: string; photoType?: string; libraryStatus?: 'SAVING' | 'SAVED' | 'ERROR' | 'UNKNOWN'; libraryError?: string }
export const usableImage = (image: ImageDraft) => !!image.fileId && ['TEMP', 'READY'].includes(image.status);
function ImageRow({ item, accountId, disabled, onRetry, hideRefresh }: { item: ImageDraft; accountId: string; disabled: boolean; onRetry: () => void; hideRefresh: boolean }) {
  const sending = item.status === 'SENDING' || item.status === 'COMPLETING';
  return <>{item.previewUrl ? <div className="private-image"><Image src={item.previewUrl} alt={item.name} preview={false} /></div> : usableImage(item) ? <PrivateImage accountId={accountId} fileId={item.fileId!} alt={item.name} thumbnail hideRefresh={hideRefresh} /> : <div className="upload-placeholder"><Typography.Text>图片不可用</Typography.Text></div>}
    <Typography.Text className="image-name">{item.name}</Typography.Text>
    {sending ? <Typography.Text type="secondary" role="status">正在上传…</Typography.Text> : null}
    {item.error ? <Feedback type="error" title={item.error} /> : null}
    {item.status === 'ERROR' ? <Button disabled={disabled} loading={sending} onClick={onRetry}>{item.completePending ? '重试完成上传' : '重试上传'}</Button> : null}</>;
}
export function ImageUpload({ accountId, items, setItems, disabled, mode = 'wardrobe', maxFiles, photoType, renderItem }: { photoType?: string; renderItem?: (item: ImageDraft, retry: () => void, remove: () => void) => ReactNode; maxFiles?: number; mode?: 'wardrobe' | 'photo' | 'design'; accountId: string; items: ImageDraft[]; setItems: Dispatch<SetStateAction<ImageDraft[]>>; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const uploads = useRef(new Map<string, AbortController>());
  const originals = useRef(new Map<string, File>());
  const previews = useRef(new Map<string, string>());
  const [error, setError] = useState('');
  useEffect(() => {
    const active = uploads.current, urls = previews.current;
    return () => { active.forEach(c => c.abort()); active.clear(); urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); originals.current.clear(); };
  }, []);
  useEffect(() => {
    const keys = new Set(items.map(item => item.key));
    for (const [key, url] of previews.current) if (!keys.has(key)) {
      URL.revokeObjectURL(url); previews.current.delete(key); originals.current.delete(key);
      uploads.current.get(key)?.abort(); uploads.current.delete(key);
    }
  }, [items]);
  function update(key: string, controller: AbortController, patch: Partial<ImageDraft>) {
    if (!controller.signal.aborted) setItems(current => controller.signal.aborted ? current : current.map(item => item.key === key ? { ...item, ...patch } : item));
  }
  async function complete(key: string, fileId: string, controller: AbortController) {
    update(key, controller, { fileId, status: 'COMPLETING', error: undefined });
    try {
      const asset = await request<FileAsset>(`/files/${fileId}/complete`, { method: 'POST', signal: controller.signal });
      if (!['TEMP', 'READY'].includes(asset.status)) throw new Error('上传尚未完成，请重试');
      update(key, controller, { status: asset.status, completePending: false, error: undefined });
    } catch (failure) {
      const retryable = !(failure instanceof ApiError) || failure.status >= 500 || failure.status === 409 || failure.status === 429;
      update(key, controller, { status: 'ERROR', completePending: retryable, error: failure instanceof Error ? failure.message : '上传结果暂未确认，请重试' });
    }
  }
  async function retryComplete(item: ImageDraft) {
    if (disabled || !item.fileId || uploads.current.has(item.key)) return;
    const controller = new AbortController(); uploads.current.set(item.key, controller);
    try { await complete(item.key, item.fileId, controller); }
    finally { if (uploads.current.get(item.key) === controller) uploads.current.delete(item.key); }
  }
  async function upload(file: File, retryItem?: ImageDraft) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024 || !file.size) { setError('请选择不超过 20 MB 的 JPEG、PNG 或 WebP 图片。'); return; }
    const key = retryItem?.key ?? crypto.randomUUID();
    originals.current.set(key, file);
    const controller = new AbortController();
    uploads.current.set(key, controller);
    const previewUrl = retryItem?.previewUrl ?? URL.createObjectURL(file); previews.current.set(key, previewUrl);
    const draft = { key, name: file.name, status: 'SENDING', previewUrl, photoType: retryItem?.photoType ?? photoType };
    setItems(current => retryItem ? current.map(item => item.key === key ? draft : item) : [...current, draft]);
    try {
      const intent = await request<{ fileId: string; key: string; uploadUrl: string; token: string; expiresAt: string }>('/files/upload-intents', { method: 'POST', body: { originalName: file.name, sizeBytes: file.size, mimeType: file.type }, signal: controller.signal });
      const body = new FormData(); body.append('token', intent.token); body.append('key', intent.key); body.append('file', file);
      const response = await fetch(intent.uploadUrl, { method: 'POST', body, signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('图片上传失败，请重试');
      if (!controller.signal.aborted) await complete(key, intent.fileId, controller);
    } catch (failure) {
      update(key, controller, { status: 'ERROR', error: failure instanceof Error ? failure.message : '图片上传失败' });
    } finally { if (uploads.current.get(key) === controller) uploads.current.delete(key); }
  }
  function selectFiles(selected: File[]) {
    if (disabled) return;
    setError('');
    if (maxFiles !== undefined && items.length + selected.length > maxFiles) setError(`最多选择 ${maxFiles} 张图片，请先移除已有图片。`);
    else for (const file of selected) void upload(file);
  }
  function retry(item: ImageDraft) {
    if (disabled || uploads.current.has(item.key)) return;
    if (item.completePending) void retryComplete(item);
    else { const file = originals.current.get(item.key); if (file) void upload(file, item); }
  }
  function remove(item: ImageDraft) { uploads.current.get(item.key)?.abort(); setItems(current => current.filter(v => v.key !== item.key)); }
  function move(index: number, offset: number) {
    setItems(current => { const next = [...current]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  }
  return <div>{mode !== 'photo' && <Typography.Paragraph type="secondary">{mode === 'wardrobe' ? '一次添加一件单品，可上传多张图片；第一张为封面，可前后调整顺序。' : mode === 'design' ? '选择一张用于本次设计的本人照片。' : '按所选类型保存个人照片。'}支持 JPEG、PNG、WebP，单张最多 20 MB，上传完成即可保存。</Typography.Paragraph>}
    {error ? <Feedback type="error" title={error} onClose={() => setError('')} /> : null}
    <div className="dress-image-drafts">{items.map((item, index) => renderItem ? <div key={item.key}>{renderItem(item, () => retry(item), () => remove(item))}</div> : <div className="dress-image-draft" key={item.key}><Tag color={index === 0 ? 'green' : undefined}>{mode === 'wardrobe' && index === 0 ? '封面' : `图片 ${index + 1}`}</Tag><ImageRow item={item} accountId={accountId} disabled={disabled} onRetry={() => retry(item)} hideRefresh={mode === 'wardrobe'} />
      <Space wrap>{mode === 'wardrobe' ? <><Button size="small" aria-label={`前移图片 ${index + 1}`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>前移</Button><Button size="small" aria-label={`后移图片 ${index + 1}`} disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)}>后移</Button></> : null}<Button size="small" danger disabled={disabled} onClick={() => { uploads.current.get(item.key)?.abort(); setItems(current => current.filter(v => v.key !== item.key)); }}>移除</Button></Space></div>)}</div>
    <input hidden style={{ display: 'none' }} ref={input} type="file" multiple={maxFiles !== 1} accept="image/jpeg,image/png,image/webp" onChange={e => { selectFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    {mode === 'photo' ? <Button htmlType="button" className="photo-dropzone" disabled={disabled} onClick={() => input.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectFiles(Array.from(event.dataTransfer.files)); }}><span className="photo-drop-plus" aria-hidden="true">＋</span><strong>点击选择照片，或拖拽到这里</strong><span>JPEG、PNG、WebP · 单张不超过 20 MB</span></Button> : mode === 'wardrobe' ? <Button htmlType="button" className="wardrobe-upload-zone" disabled={disabled || maxFiles !== undefined && items.length >= maxFiles} onClick={() => input.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectFiles(Array.from(event.dataTransfer.files)); }}><span className="wardrobe-upload-plus" aria-hidden="true">＋</span><strong>{items.length ? '继续添加这件单品的图片' : '点击选择单品图片，或拖拽到这里'}</strong><span>同一件单品可添加多张图片 · 第一张为封面</span></Button> : <Button disabled={disabled || maxFiles !== undefined && items.length >= maxFiles} onClick={() => input.current?.click()}>选择图片</Button>}
  </div>;
}
