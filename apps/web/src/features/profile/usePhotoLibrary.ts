import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from '../../api/client';
import { usableImage, type ImageDraft } from '../wardrobe/ImageUpload';
import type { Photo } from './queries';
import type { Page } from '../designs/queries';

// POST /photos is not idempotent. Unknown writes may only be reconciled by reads.
export function usePhotoLibrary(accountId: string, items: ImageDraft[], setItems: Dispatch<SetStateAction<ImageDraft[]>>, onSaved: (type: string) => void) {
  const client = useQueryClient();
  const active = useRef(new Set<string>());
  const attempted = useRef(new Set<string>());
  const mounted = useRef(true);
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function patch(key: string, value: Partial<ImageDraft>) {
    if (mounted.current) setItems(current => current.map(item => item.key === key ? { ...item, ...value } : item));
  }
  async function save(item: ImageDraft, reconcile = false) {
    if (!item.fileId || !item.photoType || active.current.has(item.key)) return;
    active.current.add(item.key);
    attempted.current.add(item.key);
    patch(item.key, { libraryStatus: 'SAVING', libraryError: undefined });
    try {
      if (reconcile) {
        let found = false;
        for (let page = 1; ; page++) {
          const result = await request<Page<Photo>>(`/photos?page=${page}&pageSize=100&photoType=${item.photoType}`);
          if (!mounted.current) return;
          if (result.items.some(photo => photo.fileId === item.fileId && photo.photoType === item.photoType)) { found = true; break; }
          if (page * 100 >= result.total || !result.items.length) break;
        }
        if (!found) {
          patch(item.key, { libraryStatus: 'UNKNOWN', libraryError: '暂未查到这张照片，原请求可能仍在处理。请稍后再次核对。' });
          return;
        }
      } else {
        await request<Photo>('/photos', { method: 'POST', body: { fileId: item.fileId, photoType: item.photoType } });
      }
      patch(item.key, { libraryStatus: 'SAVED', libraryError: undefined });
      if (mounted.current) savedCallback.current(item.photoType);
      // A failed list refresh cannot turn a confirmed write into a retryable write.
      void client.invalidateQueries({ queryKey: ['photos', accountId] }).catch(() => {});
    } catch (error) {
      const rejected = !reconcile && error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
      patch(item.key, { libraryStatus: rejected ? 'ERROR' : 'UNKNOWN', libraryError: rejected ? error.message : '入库结果暂未确认，请核对后继续。' });
    } finally { active.current.delete(item.key); }
  }
  useEffect(() => {
    for (const item of items) if (usableImage(item) && item.photoType && !item.libraryStatus && !attempted.current.has(item.key)) void save(item);
  }, [items]);
  return { retry: (item: ImageDraft) => { if (item.libraryStatus === 'ERROR' || item.libraryStatus === 'UNKNOWN') void save(item, item.libraryStatus === 'UNKNOWN'); } };
}
