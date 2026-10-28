import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../api/client';
import type { Page } from '../designs/queries';
import { isActive, useVisible, type DesignResult, type TaskStatus } from '../workspace/queries';
export interface OutfitGroup { id: string; name: string; version: string }
export interface OutfitItem { dressId: string; dressName: string; categoryId: string; categoryName: string; categoryCode: string; color: string | null; imageFileIds: string[]; missing: boolean }
export interface Outfit { id: string; name: string; note: string | null; pinned: boolean; version: string; revision: string; groups: OutfitGroup[]; items: OutfitItem[]; sourceOutputFileId: string | null; sourceDesignId: string | null }
export interface OutfitJob { taskId: string; outfitId: string; revision: string; kind: 'EVALUATION' | 'IMAGE'; status: TaskStatus; stale: boolean; createdAt: string; errorMessage: string | null; actions: string[]; outputFileId: string | null; result: DesignResult | null }
export function useOutfits(account: string, page: number, group: string, size = 20) {
  return useQuery({ queryKey: ['outfits', account, page, group, size], queryFn: ({ signal }) => request<Page<Outfit>>(`/outfits?${new URLSearchParams({ page: String(page), pageSize: String(size), ...(group ? { groupId: group } : {}) })}`, { signal }) });
}
export function useOutfit(account: string, id: string) {
  return useQuery({ queryKey: ['outfit', account, id], queryFn: ({ signal }) => request<Outfit>(`/outfits/${id}`, { signal }), enabled: !!id });
}
export function useGroups(account: string, page: number) {
  return useQuery({ queryKey: ['outfit-groups', account, page], queryFn: ({ signal }) => request<Page<OutfitGroup>>(`/outfit-groups?page=${page}&pageSize=20`, { signal }) });
}
export function useOutfitWrite(account: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) => request<Outfit>(input.path, input), onSuccess: async () => { await Promise.all(['outfits', 'outfit', 'outfit-groups', 'outfit-jobs', 'outfit-current-jobs', 'workspace'].map(key => client.invalidateQueries({ queryKey: [key, account] }))); } });
}
export function useJobs(account: string, id: string, page: number) {
  const visible = useVisible();
  return useQuery({ queryKey: ['outfit-jobs', account, id, page], queryFn: ({ signal }) => request<Page<OutfitJob>>(`/outfits/${id}/ai-jobs?page=${page}&pageSize=5`, { signal }), enabled: visible, staleTime: 0, refetchOnWindowFocus: false, refetchInterval: q => visible && q.state.data?.items.some(j => isActive(j.status)) ? 3000 : false });
}
export type PendingOutfitJob = { key: string; outfitId: string; body: { kind: 'EVALUATION' | 'IMAGE'; revision: string; personFileId?: string } } | { key: string; outfitId: string; sourceId: string; body: { mode: 'FULL' | 'IMAGE_ONLY' } };
const prefix = 'lookmate:outfit-job:v1:';
export function readPendingJob(account: string, outfit: string): PendingOutfitJob | null {
  try { const value = JSON.parse(sessionStorage.getItem(prefix + account + ':' + outfit) || 'null') as PendingOutfitJob | null; return value?.outfitId === outfit && typeof value.key === 'string' && value.body ? value : null; } catch { return null; }
}
export function persistPendingJob(account: string, outfit: string, pending: PendingOutfitJob | null) { const key = prefix + account + ':' + outfit; if (pending) sessionStorage.setItem(key, JSON.stringify(pending)); else sessionStorage.removeItem(key); }
export function clearOutfitRecovery() { Object.keys(sessionStorage).filter(k => k.startsWith(prefix)).forEach(k => sessionStorage.removeItem(k)); }
export function submitJob(pending: PendingOutfitJob) { return request<OutfitJob>('sourceId' in pending ? `/outfit-ai-jobs/${pending.sourceId}/retry` : `/outfits/${pending.outfitId}/ai-jobs`, { method: 'POST', headers: { 'Idempotency-Key': pending.key }, body: pending.body }); }

export function useCurrentOutfitJobs(account: string, id: string) {
  const visible = useVisible();
  return useQuery({ queryKey: ['outfit-current-jobs', account, id], queryFn: ({signal}) => request<{evaluation: OutfitJob | null; image: OutfitJob | null; latest: OutfitJob | null}>(`/outfits/${id}/ai-jobs/current`, {signal}), enabled: !!id && visible, refetchInterval: q => visible && q.state.data?.latest && isActive(q.state.data.latest.status) ? 3000 : false });
}
