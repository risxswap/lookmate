import { useState } from 'react';
import { Button, Modal, Space, Typography } from 'antd';
import { PrivateImage } from './PrivateImage';
import type { Dress } from './queries';

export function DressPreview({ accountId, dress, onClose }: { accountId: string; dress: Dress; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const image = dress.images[index];
  return <Modal open title={dress.name} width={1000} onCancel={onClose} className="wardrobe-preview" footer={<Space>
    {dress.images.length > 1 ? <><Button disabled={index === 0} onClick={() => setIndex(current => current - 1)}>上一张</Button><Typography.Text aria-live="polite">{index + 1} / {dress.images.length}</Typography.Text><Button disabled={index === dress.images.length - 1} onClick={() => setIndex(current => current + 1)}>下一张</Button></> : null}
    <Button onClick={onClose}>关闭</Button>
  </Space>}>
    {image ? <PrivateImage key={image.fileId} accountId={accountId} fileId={image.fileId} alt={`${dress.name} · 图片 ${index + 1}`} hideRefresh preview={false} /> : <Typography.Text>这件单品暂无可预览图片</Typography.Text>}
  </Modal>;
}
