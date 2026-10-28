import { useState } from 'react';
import { Alert, Button, Input, Pagination, Select, Space } from 'antd';
import { presetScenes, useScenes } from './api';

export function SceneChoice({ accountId, value, onChange, disabled = false }: { accountId: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [page, setPage] = useState(1);
  const [custom, setCustom] = useState(false);
  const query = useScenes(accountId, page);
  const names = [...new Set([...presetScenes, ...(query.data?.items.map(s => s.name) || []), ...(value ? [value] : [])])];
  return <div className="planner-scene-choice">
    <div className="planner-scene-control"><Select aria-label="场景" value={value || undefined} disabled={disabled} loading={query.isFetching} options={names.map(name => ({ value: name, label: name }))} onChange={next => { setCustom(false); onChange(next); }} /><Button disabled={disabled} onClick={() => { setCustom(true); onChange(''); }}>自定义</Button></div>
    {custom && <Input aria-label="自定义场景" maxLength={20} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder="例如：参加婚礼" />}
    {query.isError && <Alert type="warning" title="自定义场景读取失败" action={<Button size="small" onClick={() => void query.refetch()}>重试</Button>} />}
    {query.data && query.data.total > 20 && <Space><span>更多场景</span><Pagination size="small" current={page} pageSize={20} total={query.data.total} showSizeChanger={false} onChange={setPage} disabled={disabled} /></Space>}
  </div>;
}
