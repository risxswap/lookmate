import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../api/client';
import { isActive, useVisible, type TaskSummary } from '../workspace/queries';
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export interface Collection { id: string; name: string; version: string; createdAt: string; updatedAt: string }
export interface Favorite { id: string; resultId: string; createdAt: string; collectionIds: string[]; task: TaskSummary }
export function useRecords(accountId: string, page: number, type: string, status: string) {
  const visible = useVisible();
  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (type) params.set('designType', type);
  if (status) params.set('status', status);
  return useQuery({ queryKey: ['designs', accountId, page, type, status],
    queryFn: ({ signal }) => request<Page<TaskSummary>>(`/designs?${params}`, { signal }),
    enabled: visible, staleTime: 0, refetchOnWindowFocus: false,
    refetchInterval: q => visible && q.state.data?.items.some(t => isActive(t.status)) ? 3000 : false });
}
export function useFavorites(accountId: string, page: number, collectionId = '') {
  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (collectionId) params.set('collectionId', collectionId);
  return useQuery({ queryKey: ['favorites', accountId, page, collectionId],
    queryFn: ({ signal }) => request<Page<Favorite>>(`/favorites?${params}`, { signal }) });
}
export function useCollections(accountId: string, page: number) {
  return useQuery({ queryKey: ['collections', accountId, page],
    queryFn: ({ signal }) => request<Page<Collection>>(`/collections?page=${page}&pageSize=10`, { signal }) });
}
export function useRecordWrite(accountId: string) {
  const client = useQueryClient();
  return useMutation({ retry: false,
    mutationFn: (input: { path: string; method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown }) => request<unknown>(input.path, input),
    onSuccess: async () => { await Promise.all(['workspace', 'design', 'designs', 'favorites', 'collections'].map(key => client.invalidateQueries({ queryKey: [key, accountId] }))); },
  });
}

// A successful refresh can remove the final item from the current page.
export function usePageBounds(total: number | undefined, pageSize: number, succeeded: boolean, setPage: Dispatch<SetStateAction<number>>) {
  useEffect(() => {
    if (succeeded && total !== undefined) {
      const lastPage = Math.max(1, Math.ceil(total / pageSize));
      setPage(current => Math.min(current, lastPage));
    }
  }, [total, pageSize, succeeded, setPage]);
}
