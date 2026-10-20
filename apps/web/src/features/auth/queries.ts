import { useQuery } from '@tanstack/react-query';
import { ApiError, request, type Account } from '../../api/client';
export const accountKey = ['auth', 'me'] as const;
export function useAccount() {
  return useQuery({
    queryKey: accountKey,
    queryFn: async ({ signal }) => {
      try { return await request<Account>('/auth/me', { signal }); }
      catch (error) {
        if (error instanceof ApiError && error.detail.code === 'UNAUTHENTICATED') return null;
        throw error;
      }
    },
    staleTime: 0,
  });
}
export function useAuthConfig() {
  return useQuery({ queryKey: ['auth', 'config'], queryFn: ({ signal }) => request<{ registrationEnabled: boolean }>('/auth/config', { signal }) });
}
