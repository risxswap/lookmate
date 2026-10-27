import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Image, Spin } from 'antd';
import { request } from '../../api/client';
import type { Dress } from './queries';

const placeholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function DressPreview({ accountId, dress, onClose }: { accountId: string; dress: Dress; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const fileId = dress.images[index]?.fileId;
  const query = useQuery({
    queryKey: ['file-access', accountId, fileId, 'DISPLAY'],
    queryFn: ({ signal }) => request<{ url: string; expiresAt: string }>(`/files/${fileId}/access`, { method: 'POST', body: { variant: 'DISPLAY' }, signal }),
    enabled: !!fileId,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: q => q.state.data ? Math.max(10000, Date.parse(q.state.data.expiresAt) - Date.now() - 30000) : false,
  });
  return <Image.PreviewGroup
    items={dress.images.map((_, current) => ({
      src: current === index && query.data && !query.isError ? query.data.url : placeholder,
      alt: `${dress.name} · 图片 ${current + 1}`,
    }))}
    preview={{
      open: true,
      current: index,
      onOpenChange: open => { if (!open) onClose(); },
      onChange: current => { setFailed(false); setIndex(current); },
      imageRender: original => query.isPending ? <Spin size="large" aria-label="正在加载图片" /> : query.isError || failed ? <Alert type="error" title="图片暂时无法读取" action={<Button loading={query.isFetching} onClick={() => { setFailed(false); void query.refetch(); }}>重试</Button>} /> : <div style={{ display: 'contents' }} onErrorCapture={() => setFailed(true)}>{original}</div>,
    }}
  />;
}
