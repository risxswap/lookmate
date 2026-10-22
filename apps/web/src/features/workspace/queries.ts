import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, request } from '../../api/client';

export type TaskStatus = 'QUEUED' | 'PLANNING' | 'GENERATING' | 'SAVING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export interface TaskSummary {
  outfitId?: string | null;
  jobKind?: 'EVALUATION' | 'IMAGE' | null;
  id: string;
  designType: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  title: string | null;
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  actions: string[];
  resultId: string | null;
  favoriteId: string | null;
}
export interface DesignResult {
  id: string;
  title: string;
  summary: string;
  style: string;
  occasion: string;
  designReason: string;
  colorAdvice: string | null;
  wearingAdvice: string | null;
  hairstyle: null | {
    hairstyleName: string; lengthAdvice: string; bangsAdvice: string;
    partingAdvice: string; textureAdvice: string; hairColorAdvice: string; careAdvice: string;
  };
  matchLevel?: string | null;
  notices?: import('../generation/api').DesignNotice[];
  illustrativeShoes?: { description: string; source: string } | null;
  novelty?: { description?: string; explanation?: string } | null;
  items: { imageFileIds?: string[]; role?: string; dressId: string; dressName: string; categoryName: string; matchReason: string; wearingMethod: string }[];
}
export interface DesignDetail extends TaskSummary {
  result: DesignResult | null;
  inputSummary?: import('../generation/api').InputSummary | null;
  outputFileId?: string | null;
  failure?: { stage: string; category: string; code: string; message: string; suggestedAction: string } | null;
}
export interface WorkspaceData { activeTask: TaskSummary | null; recentTasks: TaskSummary[] }
export const isActive = (status?: TaskStatus) => status !== undefined && ['QUEUED', 'PLANNING', 'GENERATING', 'SAVING'].includes(status);
const subscribeVisibility = (callback: () => void) => {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
};
const getVisibility = () => document.visibilityState !== 'hidden';
export function useVisible() { return useSyncExternalStore(subscribeVisibility, getVisibility); }

export function useWorkspace(accountId: string) {
  const visible = useVisible();
  return useQuery({
    queryKey: ['workspace', accountId],
    queryFn: ({ signal }) => request<WorkspaceData>('/workspace', { signal }),
    enabled: visible,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: query => visible && isActive(query.state.data?.activeTask?.status) ? 3000 : false,
  });
}
export function useDesignDetail(accountId: string, id: string) {
  const visible = useVisible();
  return useQuery({
    queryKey: ['design', accountId, id],
    queryFn: ({ signal }) => request<DesignDetail>(`/designs/${encodeURIComponent(id)}`, { signal }),
    enabled: visible,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: query => visible && isActive(query.state.data?.status)
      && !(query.state.error instanceof ApiError && query.state.error.status >= 400 && query.state.error.status < 500) ? 3000 : false,
  });
}
