import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from '../../api/client';
import type { Page } from '../designs/queries';
import { useVisible } from '../workspace/queries';
export interface Category { id: string; code: string; name: string; sortOrder: number }
export const seasons = [{ value: 'SPRING', label: '春季' }, { value: 'SUMMER', label: '夏季' }, { value: 'AUTUMN', label: '秋季' }, { value: 'WINTER', label: '冬季' }];
export const featureLabels = { viewType: '拍摄视角', description: '单品描述', colors: '颜色', pattern: '图案', styleTags: '风格标签', fit: '版型', materialDescription: '材质说明', details: '细节' };
export type FeatureKey = keyof typeof featureLabels;
export type Features = Partial<Record<FeatureKey, string | string[] | Record<string, string | null> | null>>;
export interface DressImage { id: string; fileId: string; sortOrder: number; version: string; aiFeatures: Features | null; manualFeatures: Features | null; effectiveFeatures: Features | null; recognitionId: string | null; aiCurrent: boolean }
export interface Recognition { id: string; status: string; errorCode: string | null; errorMessage: string | null; createdAt: string; updatedAt: string }
export interface Dress { id: string; name: string; categoryId: string; color: string | null; seasons: string[]; notes: string | null; imageRevision: string; createdAt: string; updatedAt: string; images: DressImage[]; recognition: Recognition | null }
export interface FileAsset { id: string; status: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null; validationError: string | null }
export const recognizing = (r?: Recognition | null) => !!r && ['PENDING', 'RUNNING'].includes(r.status);
export const recognitionLabels: Record<string, string> = { PENDING: '等待识别', RUNNING: '正在识别', SUCCEEDED: '识别完成', FAILED: '识别失败', UNKNOWN: '识别结果待确认' };
export function useCategories(accountId: string) {
  return useQuery({ queryKey: ['dress-categories', accountId], queryFn: ({ signal }) => request<Category[]>('/dresses/categories', { signal }) });
}
export function useDresses(accountId: string, page: number, categoryId: string) {
  const visible = useVisible();
  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (categoryId) params.set('categoryId', categoryId);
  return useQuery({ queryKey: ['dresses', accountId, page, categoryId], queryFn: ({ signal }) => request<Page<Dress>>(`/dresses?${params}`, { signal }), enabled: visible, refetchOnWindowFocus: false,
    refetchInterval: q => visible && !(q.state.error instanceof ApiError && q.state.error.status >= 400 && q.state.error.status < 500) && q.state.data?.items.some(d => recognizing(d.recognition)) ? 3000 : false });
}
export function useDress(accountId: string, id: string, freshOnMount = false) {
  const visible = useVisible();
  return useQuery({ queryKey: ['dress', accountId, id], refetchOnMount: freshOnMount ? 'always' : true, queryFn: ({ signal }) => request<Dress>(`/dresses/${id}`, { signal }), enabled: visible, refetchOnWindowFocus: false,
    refetchInterval: q => visible && !(q.state.error instanceof ApiError && q.state.error.status >= 400 && q.state.error.status < 500) && recognizing(q.state.data?.recognition) ? 3000 : false });
}
export function useWardrobeWrite(accountId: string) {
  const client = useQueryClient();
  return useMutation({ retry: false, mutationFn: (input: { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) => request<unknown>(input.path, input),
    onSuccess: async () => { await Promise.all(['dresses', 'dress'].map(key => client.invalidateQueries({ queryKey: [key, accountId] }))); } });
}
export const trimText = (text: string) => text.replace(/^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/g, '');
export const countText = (text: string) => Array.from(text).length;
