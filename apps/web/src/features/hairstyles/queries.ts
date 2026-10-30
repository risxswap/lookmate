import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../../api/client';
import type { HairstyleReference } from '../generation/api';

export interface Hairstyle extends HairstyleReference {
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  favorited: boolean;
  favoritedAt: string | null;
}
export function useHairstyleFavorite(accountId: string) {
  const client = useQueryClient();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const mutation = useMutation({ retry: false,
    onMutate: style => setPendingIds(current => new Set(current).add(style.id)),
    mutationFn: (style: Hairstyle) => request<{ hairstyleId: string; favorited: boolean; favoritedAt: string } | null>(`/hairstyles/${encodeURIComponent(style.id)}/favorite`, { method: style.favorited ? 'DELETE' : 'PUT' }),
    onSettled: async (_data, _error, style) => { try { await Promise.all(['hairstyles', 'hairstyle'].map(key => client.invalidateQueries({ queryKey: [key, accountId] }))); } finally { setPendingIds(current => { const next = new Set(current); next.delete(style.id); return next; }); } },
  });
  return { ...mutation, pendingIds };
}
