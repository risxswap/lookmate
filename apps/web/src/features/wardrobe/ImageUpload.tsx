import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Space, Tag, Typography } from 'antd';
import { ApiError, request } from '../../api/client';
import { useVisible } from '../workspace/queries';
import type { FileAsset } from './queries';
import { PrivateImage } from './PrivateImage';
export interface ImageDraft { key: string; imageId?: string; fileId?: string; name: string; status: string; error?: string; completePending?: boolean }
export const usableImage = (image: ImageDraft) => !!image.fileId && ['TEMP', 'READY'].includes(image.status);
function ImageRow({ item, accountId, onStatus }: { item: ImageDraft; accountId: string; onStatus: (file: Pick<FileAsset, 'status' | 'validationError'>) => void }) {
  const visible = useVisible();
  const polling = !!item.fileId && ['UPLOADING', 'VERIFYING'].includes(item.status);
  const query = useQuery({ queryKey: ['file-status', accountId, item.fileId], queryFn: ({ signal }) => request<FileAsset>(`/files/${item.fileId}`, { signal }), enabled: polling && visible,
    retry: false, refetchOnWindowFocus: false, refetchInterval: q => !q.state.error && visible && ['UPLOADING', 'VERIFYING'].includes(q.state.data?.status ?? item.status) ? 2000 : false });
  const complete = useMutation({ retry: false, mutationFn: () => request<FileAsset>(`/files/${item.fileId}/complete`, { method: 'POST' }), onSuccess: onStatus });
  useEffect(() => { if (item.status !== 'DELETING' && query.error instanceof ApiError && query.error.status === 404) onStatus({ status: 'DELETING', validationError: '图片已失效，请移除后重新选择' }); }, [query.error, item.status, onStatus]);
  useEffect(() => { if (!query.isError && query.data && polling && query.data.status !== item.status) onStatus(query.data); }, [query.data, query.isError, polling, item.status, onStatus]);
  return <>{usableImage(item) ? <PrivateImage accountId={accountId} fileId={item.fileId!} alt={item.name} thumbnail /> : <div className="upload-placeholder"><Typography.Text>{item.status === 'SENDING' ? '正在上传…' : polling ? '正在核验图片…' : '图片不可用'}</Typography.Text></div>}
    <Typography.Text className="image-name">{item.name}</Typography.Text>
    {item.error ? <Alert type="error" showIcon title={item.error} description={item.completePending ? '图片已上传，可重新提交核验。' : '请移除此图后重新选择。'} /> : null}
    {item.completePending ? <Button loading={complete.isPending} onClick={() => complete.mutate()}>重新提交核验</Button> : null}
    {complete.isError ? <Alert type="error" title={complete.error.message} /> : null}
    {query.isError ? <Alert type="error" title={query.error.message} action={<Button size="small" loading={query.isFetching} onClick={() => void query.refetch()}>重试核验查询</Button>} /> : null}</>;
}
export function ImageUpload({ accountId, items, setItems, disabled }: { accountId: string; items: ImageDraft[]; setItems: Dispatch<SetStateAction<ImageDraft[]>>; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const uploads = useRef(new Map<string, AbortController>());
  const [error, setError] = useState('');
  useEffect(() => { const active = uploads.current; return () => { active.forEach(c => c.abort()); active.clear(); }; }, []);
  async function upload(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024 || !file.size) { setError('请选择不超过 20 MB 的 JPEG、PNG 或 WebP 图片。'); return; }
    const key = crypto.randomUUID();
    const controller = new AbortController();
    uploads.current.set(key, controller);
    setItems(current => [...current, { key, name: file.name, status: 'SENDING' }]);
    let uploadedFileId: string | undefined;
    try {
      const intent = await request<{ fileId: string; key: string; uploadUrl: string; token: string; expiresAt: string }>('/files/upload-intents', { method: 'POST', body: { originalName: file.name, sizeBytes: file.size, mimeType: file.type }, signal: controller.signal });
      const body = new FormData(); body.append('token', intent.token); body.append('key', intent.key); body.append('file', file);
      const response = await fetch(intent.uploadUrl, { method: 'POST', body, signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('图片上传失败，请移除此图后重新选择');
      uploadedFileId = intent.fileId;
      const asset = await request<FileAsset>(`/files/${intent.fileId}/complete`, { method: 'POST', signal: controller.signal });
      if (!controller.signal.aborted) setItems(current => current.map(item => item.key === key ? { ...item, fileId: intent.fileId, status: asset.status, error: asset.validationError ?? undefined } : item));
    } catch (failure) {
      if (!controller.signal.aborted) setItems(current => current.map(item => item.key === key ? { ...item, fileId: uploadedFileId, status: 'ERROR', completePending: !!uploadedFileId, error: failure instanceof Error ? failure.message : '图片上传失败' } : item));
    } finally { uploads.current.delete(key); }
  }
  function move(index: number, offset: number) {
    setItems(current => { const next = [...current]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  }
  return <div><Typography.Paragraph type="secondary">至少一张，第一张为封面。支持 JPEG、PNG、WebP，单张最多 20 MB、2500 万像素；上传后会核验图片。</Typography.Paragraph>
    {error ? <Alert className="form-alert" type="error" showIcon title={error} closable onClose={() => setError('')} /> : null}
    <div className="dress-image-drafts">{items.map((item, index) => <div className="dress-image-draft" key={item.key}><Tag color={index === 0 ? 'green' : undefined}>{index === 0 ? '封面' : `图片 ${index + 1}`}</Tag><ImageRow item={item} accountId={accountId} onStatus={file => setItems(current => current.map(v => v.key === item.key ? { ...v, status: file.status, completePending: false, error: file.validationError ?? (['REJECTED', 'DELETING'].includes(file.status) ? '图片核验未通过或已失效' : undefined) } : v))} />
      <Space wrap><Button size="small" aria-label={`前移图片 ${index + 1}`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>前移</Button><Button size="small" aria-label={`后移图片 ${index + 1}`} disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)}>后移</Button><Button size="small" danger disabled={disabled} onClick={() => { uploads.current.get(item.key)?.abort(); setItems(current => current.filter(v => v.key !== item.key)); }}>移除</Button></Space></div>)}</div>
    <input hidden ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => { setError(''); for (const file of Array.from(e.target.files ?? [])) void upload(file); e.target.value = ''; }} />
    <Button disabled={disabled} onClick={() => input.current?.click()}>选择图片</Button>
  </div>;
}
