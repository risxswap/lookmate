import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Image, Skeleton, Typography } from 'antd';
import { request } from '../../api/client';
import { useVisible } from '../workspace/queries';
export function PrivateImage({ accountId, fileId, alt, thumbnail = false, compact = false }: { accountId: string; fileId: string; alt: string; thumbnail?: boolean; compact?: boolean }) {
  const visible = useVisible();
  const [failed, setFailed] = useState(false);
  const variant = thumbnail ? 'THUMBNAIL' : 'DISPLAY';
  const query = useQuery({ queryKey: ['file-access', accountId, fileId, variant], queryFn: ({ signal }) => request<{ url: string; expiresAt: string }>(`/files/${fileId}/access`, { method: 'POST', body: { variant }, signal }), enabled: visible,
    staleTime: 0, refetchOnWindowFocus: false, refetchInterval: q => visible && q.state.data ? Math.max(10000, Date.parse(q.state.data.expiresAt) - Date.now() - 30000) : false });
  return <div className={`private-image${compact ? ' private-image-compact' : ''}`}>{query.isPending ? <Skeleton.Image active /> : query.data && !query.isError && !failed ? <Image src={query.data.url} alt={alt} preview={!thumbnail} onError={() => setFailed(true)} /> : <Typography.Text type="secondary">图片暂时无法读取</Typography.Text>}{!compact || query.isError || failed ? <Button className="image-refresh" size="small" loading={query.isFetching} onClick={() => { setFailed(false); void query.refetch(); }}>刷新图片</Button> : null}</div>;
}
