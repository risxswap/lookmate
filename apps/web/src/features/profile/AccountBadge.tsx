import { Avatar } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { request, type Account } from '../../api/client';

export function AccountBadge({ account }: { account: Account }) {
  const name = account.displayName || account.username || '微信用户';
  const image = useQuery({
    queryKey: ['file-access', account.id, account.avatarFileId, 'THUMBNAIL'],
    queryFn: ({ signal }) => request<{ url: string; expiresAt: string }>(`/files/${account.avatarFileId}/access`, { method: 'POST', body: { variant: 'THUMBNAIL' }, signal }),
    enabled: !!account.avatarFileId,
    refetchOnWindowFocus: true,
    refetchInterval: query => query.state.data ? Math.max(10000, Date.parse(query.state.data.expiresAt) - Date.now() - 30000) : false,
  });
  return <Avatar size={32} src={account.avatarFileId && !image.isError ? image.data?.url : undefined} style={{ backgroundColor: '#e5eee7', color: '#315c50' }}>{Array.from(name)[0]}</Avatar>;
}
