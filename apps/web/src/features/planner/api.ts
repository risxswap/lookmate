import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from '../../api/client';
import type { Page } from '../designs/queries';
import type { Outfit } from '../outfits/api';

export interface OutfitPlan {
  id: string; version: string; date: string; scene: string; note: string | null;
  sourceOutfitId: string | null; sourceMissing: boolean; outfit: Outfit | null;
  createdAt: string; updatedAt: string;
}
export interface CreatePlan { clientRequestId: string; date: string; scene: string; note: string | null; outfitId: string | null }
export const presetScenes = ['通勤', '日常', '约会', '运动', '聚会', '旅行'];
export function usePlans(account: string, date: string, page: number) {
  return useQuery({ queryKey: ['outfit-plans', account, date, page], queryFn: ({ signal }) => request<Page<OutfitPlan>>(`/outfit-plans?${new URLSearchParams({ date, page: String(page), pageSize: '5' })}`, { signal }) });
}
export function usePlanCalendar(account: string, from: string, to: string, enabled = true) {
  return useQuery({ queryKey: ['outfit-calendar', account, from, to], enabled, queryFn: ({ signal }) => request<{ days: { date: string; count: number }[] }>(`/outfit-plans/calendar?${new URLSearchParams({ from, to })}`, { signal }) });
}
export function useScenes(account: string, page: number) {
  return useQuery({ queryKey: ['outfit-scenes', account, page], queryFn: ({ signal }) => request<Page<{ name: string }>>(`/outfit-scenes?page=${page}&pageSize=20`, { signal }) });
}
type PlanLocation = Pick<OutfitPlan, 'date' | 'scene'>;
export function useRefreshPlans(account: string) {
  const client = useQueryClient();
  return (previous: PlanLocation | null = null, next: PlanLocation | null = null, submittedDate?: string) => {
    // An unknown outcome or a version conflict can leave the current date and scene unknown.
    const unknown = !previous && !next;
    const dates = [previous?.date, next?.date, submittedDate].filter((date): date is string => !!date);
    return client.invalidateQueries({ predicate: ({ queryKey: [resource, owner, from, to] }) => {
      if (owner !== account) return false;
      if (resource === 'outfit-plans') return unknown || dates.some(date => date === from);
      if (resource === 'outfit-calendar') return unknown || (previous?.date !== next?.date &&
        typeof from === 'string' && typeof to === 'string' && dates.some(date => date >= from && date <= to));
      return resource === 'outfit-scenes' && (unknown || (!!next && next.scene !== previous?.scene && !presetScenes.includes(next.scene)));
    } });
  };
}
export function useRefreshOutfitScenes(account: string, outfit: Outfit) {
  const client = useQueryClient();
  return (next?: string[]) => {
    const previous = outfit.scenes ?? [];
    return client.invalidateQueries({ predicate: ({ queryKey: [resource, owner, id, , , scene] }) => {
      if (owner !== account) return false;
      if (resource === 'outfit') return id === outfit.id;
      if (resource === 'outfits') return !next || !scene || previous.includes(String(scene)) || next.includes(String(scene));
      return resource === 'outfit-scenes' && (!next || next.some(name => !previous.includes(name) && !presetScenes.includes(name)));
    } });
  };
}
export const unknownWrite = (error: unknown) => !(error instanceof ApiError) || error.status >= 500;
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '请求未完成，请重试';
const recoveryPrefix = 'lookmate:planner:create:';
export function readPlanRecovery(account: string): CreatePlan | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(recoveryPrefix + account) || 'null') as CreatePlan | null;
    return value && typeof value.clientRequestId === 'string' && typeof value.date === 'string' && typeof value.scene === 'string' && (value.note === null || typeof value.note === 'string') && (value.outfitId === null || typeof value.outfitId === 'string') ? value : null;
  } catch { return null; }
}
export function savePlanRecovery(account: string, value: CreatePlan | null) {
  if (value) sessionStorage.setItem(recoveryPrefix + account, JSON.stringify(value));
  else sessionStorage.removeItem(recoveryPrefix + account);
}
export function clearPlannerRecovery() {
  Object.keys(sessionStorage).filter(key => key.startsWith(recoveryPrefix)).forEach(key => sessionStorage.removeItem(key));
}
