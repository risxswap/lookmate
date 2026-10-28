import { useRef, useState } from 'react';
import { Alert, Button, Dropdown, Empty, Modal, Pagination, Select, Skeleton, Space, Tag } from 'antd';
import { request, ApiError } from '../../api/client';
import { usePageBounds } from '../designs/queries';
import { OutfitBoard } from '../outfits/OutfitsList';
import { useOutfits, type Outfit } from '../outfits/api';
import { errorMessage, presetScenes, unknownWrite, useRefreshPlanner, useScenes } from './api';

function SceneTags({ accountId, outfit, onClose }: { accountId: string; outfit: Outfit; onClose: () => void }) {
  const [scenes, setScenes] = useState(outfit.scenes || []);
  const [page, setPage] = useState(1);
  const query = useScenes(accountId, page);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const lock = useRef(false);
  const refresh = useRefreshPlanner(accountId);
  const names = [...new Set([...presetScenes, ...(query.data?.items.map(item => item.name) || []), ...scenes])];
  async function save() {
    if (lock.current || blocked) return;
    const next = [...new Set(scenes.map(scene => scene.trim()))];
    if (next.length > 20 || next.some(scene => !scene || Array.from(scene).length > 20)) { setError('最多设置20个场景，每个名称1至20字。'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      await request<Outfit>(`/outfits/${outfit.id}/scenes`, { method: 'PUT', body: { version: outfit.version, scenes: next } });
      await refresh(); onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      if (unknownWrite(failure) || failure instanceof ApiError && ['VERSION_CONFLICT', 'OUTFIT_NOT_FOUND'].includes(failure.detail.code)) setBlocked(true);
    } finally { lock.current = false; setBusy(false); }
  }
  return <Modal open title={`设置场景 · ${outfit.name}`} onCancel={onClose} onOk={() => void save()} okText="保存场景" cancelText="取消" confirmLoading={busy} okButtonProps={{ disabled: blocked }} closable={!busy} keyboard={!busy} maskClosable={false} cancelButtonProps={{ disabled: busy }}>
    <p>一套搭配可以适用于多个场景。输入新名称后按回车添加，清空则取消全部场景。</p>
    {error && <Alert showIcon type="error" title={error} />}
    {blocked && <Alert type="warning" title="请先刷新核对最新场景" description="本次选择仍保留；不会自动覆盖其他修改。" action={<Button onClick={() => { void refresh(); onClose(); }}>关闭并刷新</Button>} />}
    <Select className="planner-tags-input" aria-label="搭配场景" mode="tags" value={scenes} disabled={busy || blocked} maxCount={20} options={names.map(name => ({ value: name, label: name }))} onChange={setScenes} placeholder="选择或输入场景" />
    {query.isError && <Alert type="warning" title="场景选项读取失败，仍可直接输入" action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
    {query.data && query.data.total > 20 && <Pagination size="small" current={page} pageSize={20} total={query.data.total} showSizeChanger={false} onChange={setPage} />}
  </Modal>;
}

export function SceneOutfits({ accountId, onArrange }: { accountId: string; onArrange: (outfit: Outfit) => void }) {
  const [scene, setScene] = useState('');
  const [page, setPage] = useState(1);
  const [scenePage, setScenePage] = useState(1);
  const [tagging, setTagging] = useState<Outfit>();
  const query = useOutfits(accountId, page, '', 4, scene);
  const scenes = useScenes(accountId, scenePage);
  usePageBounds(query.data?.total, 4, query.isSuccess && !query.isFetching, setPage);
  const names = [...new Set([...(scenePage === 1 ? presetScenes : []), ...(scenes.data?.items.map(item => item.name) || []), ...(scene ? [scene] : [])])];
  return <section className="planner-scenes">
    <header className="planner-section-heading"><div><h2>场景穿搭</h2><p>从常用搭配中挑选，安排到你的日程。</p></div><Space wrap><Button href="/app/wardrobe?tab=outfits">全部常用搭配</Button><Button href="/app/wardrobe/outfits/new">组合搭配</Button></Space></header>
    <div className="planner-scene-filters" role="group" aria-label="按场景筛选">{['', ...names].map(name => <Button key={name} type={scene === name ? 'primary' : 'default'} aria-pressed={scene === name} onClick={() => { setScene(name); setPage(1); }}>{name || '全部'}</Button>)}</div>
    {scenes.isError && <Alert type="warning" title="场景选项读取失败" action={<Button onClick={() => void scenes.refetch()}>重试</Button>} />}
    {scenes.data && scenes.data.total > 20 && <div className="planner-scene-pages"><span>场景选项</span><Pagination size="small" current={scenePage} pageSize={20} total={scenes.data.total} showSizeChanger={false} onChange={setScenePage} /></div>}
    {query.isError && <Alert showIcon type="error" title={query.data ? '刷新失败，以下为上次读取的搭配' : '无法读取场景搭配'} description={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
    {query.isPending ? <Skeleton active paragraph={{ rows: 5 }} /> : query.data && <>
      {!query.data.items.length ? <Empty description={scene ? `还没有标记为「${scene}」的搭配，可在“全部”中为已有搭配设置场景。` : '还没有常用搭配，先把常穿的组合保存下来。'}><Space><Button href="/app/wardrobe/outfits/new">组合搭配</Button><Button href={`/app/design/new?occasion=${encodeURIComponent(scene)}&type=OUTFIT`}>为{scene || '日常'}设计一套</Button></Space></Empty> : <div className="planner-scene-grid">{query.data.items.map(outfit => <article key={outfit.id} className="planner-scene-card"><a className="planner-scene-image" href={`/app/wardrobe/outfits/${outfit.id}`} aria-label={`查看搭配 ${outfit.name}`}><OutfitBoard accountId={accountId} outfit={outfit} /></a><div className="planner-scene-info"><div className="planner-card-heading"><a href={`/app/wardrobe/outfits/${outfit.id}`}>{outfit.name}</a><Dropdown trigger={['click']} menu={{ items: [{ key: 'scenes', label: '设置适用场景' }], onClick: () => setTagging(outfit) }}><Button type="text" aria-label={`${outfit.name}更多操作`}>•••</Button></Dropdown></div><div className="planner-outfit-tags">{outfit.scenes?.length ? outfit.scenes.map(s => <Tag key={s}>{s}</Tag>) : <span>尚未设置场景</span>}</div><p>{outfit.items.length} 件单品{outfit.pinned ? ' · 已置顶' : ''}</p>{outfit.items.some(item => item.missing) && <Tag color="orange">有缺失单品</Tag>}<Button block onClick={() => onArrange(outfit)}>安排到日历</Button></div></article>)}</div>}
      {query.data.total > 4 && <Pagination className="planner-pagination" current={page} pageSize={4} total={query.data.total} showSizeChanger={false} onChange={setPage} />}
    </>}
    {tagging && <SceneTags key={tagging.id} accountId={accountId} outfit={tagging} onClose={() => setTagging(undefined)} />}
  </section>;
}
