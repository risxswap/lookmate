import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Drawer, Empty, Pagination, Radio, Select, Skeleton, Space, Tabs, Tag, Typography } from 'antd';
import { request } from '../../api/client';
import { navigate, useLocation, usePageState } from '../../app/navigation';
import { PageHeading } from '../../components/PageHeading';
import { OutfitReferenceCard, outfitLabels } from './OutfitReference';
import { QueryFailure, TaskCard } from '../workspace/TaskViews';
import { usePageBounds, useRecords, type Page } from '../designs/queries';
import { type OutfitInspiration, useOutfitInspirationFavorite } from './queries';
import { outfitGalleryReturn, readOutfitDraft, rememberOutfitGallery } from './drafts';
import '../generation/hairstyle.css';
import '../hairstyles/hairstyles.css';
import './outfits.css';

export function OutfitNavigation({ records = false }: { records?: boolean }) {
  return <Tabs activeKey={records ? 'records' : 'gallery'} items={[{ key: 'gallery', label: '穿搭灵感库' }, { key: 'records', label: '我的穿搭记录' }]} onChange={key => navigate(new URL(key === 'records' ? '/app/outfit-design/records' : '/app/outfit-design', window.location.origin))} />;
}
function Cover({ style }: { style: OutfitInspiration }) {
  const [failed, setFailed] = useState(false);
  return <div className="outfit-inspiration-cover">{style.image && !failed ? <img src={style.image.url} alt={`${style.name}穿搭示意图`} loading="lazy" onError={() => setFailed(true)} /> : <span>暂无参考图片</span>}</div>;
}
const positive = (value: string | null, fallback: number) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : fallback;
export function OutfitGalleryPage({ accountId }: { accountId: string }) {
  const location = useLocation();
  const scope = location.searchParams.get('scope') === 'favorites' ? 'favorites' : 'all';
  const page = positive(location.searchParams.get('page'), 1);
  const pageSize = [12, 24].includes(Number(location.searchParams.get('pageSize'))) ? Number(location.searchParams.get('pageSize')) : 12;
  const filters = Object.fromEntries((['occasion', 'style'] as const).map(key => [key, location.searchParams.get(key) || undefined]));
  const params = new URLSearchParams({ scope, page: String(page), pageSize: String(pageSize) });
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  const query = useQuery({ queryKey: ['outfit-inspirations', accountId, params.toString()], queryFn: ({ signal }) => request<Page<OutfitInspiration>>(`/outfit-inspirations?${params}`, { signal }) });
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['outfit-inspiration', accountId, detailId], queryFn: ({ signal }) => request<OutfitInspiration>(`/outfit-inspirations/${encodeURIComponent(detailId!)}`, { signal }), enabled: !!detailId });
  const favorite = useOutfitInspirationFavorite(accountId);
  const previousGallery = outfitGalleryReturn(accountId);
  const galleryHref = location.pathname + location.search;
  const [scroll, setScroll] = usePageState(`${accountId}:outfit-gallery`, 'scroll', previousGallery.href === galleryHref ? previousGallery.scroll : 0);
  const scrollRef = useRef(scroll);
  const restoredScroll = useRef(false);
  useEffect(() => {
    if (!query.data || restoredScroll.current) return;
    const frame = requestAnimationFrame(() => { window.scrollTo(0, scrollRef.current); restoredScroll.current = true; rememberOutfitGallery(accountId, galleryHref, scrollRef.current); });
    return () => cancelAnimationFrame(frame);
  }, [query.data, accountId, galleryHref]);
  useEffect(() => { const remember = () => { if (restoredScroll.current) { setScroll(window.scrollY); rememberOutfitGallery(accountId, galleryHref, window.scrollY); } }; window.addEventListener('scroll', remember); return () => window.removeEventListener('scroll', remember); }, [accountId, galleryHref, setScroll]);
  function change(values: Record<string, string | undefined>) {
    const url = new URL(window.location.href);
    Object.entries(values).forEach(([key, value]) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
    navigate(url, true);
  }
  useEffect(() => { if (query.isSuccess && !query.isFetching && page > Math.max(1, Math.ceil(query.data.total / pageSize))) change({ page: String(Math.max(1, Math.ceil(query.data.total / pageSize))) }); }, [query.isSuccess, query.isFetching, query.data?.total, page, pageSize]);
  useEffect(() => { if (restoredScroll.current) rememberOutfitGallery(accountId, galleryHref, window.scrollY); }, [accountId, galleryHref]);
  const saved = readOutfitDraft(accountId, 'gallery') || readOutfitDraft(accountId, 'free');
  function tryStyle(style: OutfitInspiration) {
    rememberOutfitGallery(accountId, galleryHref, window.scrollY);
    const next = new URL('/app/outfit-design/try', window.location.origin);
    next.searchParams.set('path', 'gallery'); next.searchParams.set('outfitInspirationId', style.id); next.searchParams.set('outfitInspirationVersion', style.version);
    navigate(next);
  }
  function favoriteButton(style: OutfitInspiration) {
    return <Button loading={favorite.pendingIds.has(style.id)} disabled={favorite.pendingIds.has(style.id) || favorite.isError && favorite.variables?.id === style.id || !style.favorited && style.availability === 'UNAVAILABLE'} aria-label={`${style.favorited ? '取消收藏' : '收藏灵感'}：${style.name}`} aria-pressed={style.favorited} onClick={() => favorite.mutate(style)}>{style.favorited ? '已收藏' : '收藏灵感'}</Button>;
  }
  return <section className="outfit-inspiration-zone">
    <PageHeading title="穿搭设计" description="挑一套喜欢的感觉，用自己的衣服搭出来。" />
    <OutfitNavigation />
    <div className="hair-zone-toolbar"><Space wrap><Radio.Group optionType="button" buttonStyle="solid" value={scope} options={[{ value: 'all', label: '全部灵感' }, { value: 'favorites', label: '已收藏' }]} onChange={e => change({ scope: e.target.value, page: '1' })} />{(['occasion', 'style'] as const).map(key => <Select key={key} aria-label={({ occasion: '推荐场合', style: '搭配风格' })[key]} placeholder={({ occasion: '全部场合', style: '全部风格' })[key]} value={filters[key]} allowClear options={Object.entries(outfitLabels[key]).map(([value, label]) => ({ value, label }))} onChange={value => change({ [key]: value, page: '1' })} />)}</Space><Space wrap>{saved ? <Button href={`/app/outfit-design/try?path=${readOutfitDraft(accountId, 'gallery') ? 'gallery' : 'free'}`}>继续未提交设计</Button> : null}<Button type="primary" href="/app/outfit-design/try?path=free">自由搭配</Button></Space></div>
    <Typography.Paragraph type="secondary" className="hair-zone-note">参考好看的搭配，用你的衣服重新搭。场合和风格标签仅供参考，不会自动填写设计要求。</Typography.Paragraph>
    {favorite.isError ? <Alert className="feature-notice" type="error" showIcon title="收藏操作未完成" description={favorite.error.message} action={<Button onClick={() => { void Promise.all([query.refetch(), ...(detailId ? [detail.refetch()] : [])]).then(results => { if (results.every(result => result.isSuccess)) favorite.reset(); }); }}>刷新收藏状态</Button>} /> : null}
    {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
    {query.isPending ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
    {query.data?.items.length === 0 && !query.isError ? <Empty description={Object.values(filters).some(Boolean) ? '暂无符合筛选条件的穿搭' : scope === 'favorites' ? '还没有收藏的穿搭' : '暂无可用灵感'}>{Object.values(filters).some(Boolean) ? <Button onClick={() => change({ occasion: undefined, style: undefined, page: '1' })}>清除筛选</Button> : scope === 'favorites' ? <Button onClick={() => change({ scope: 'all', page: '1' })}>去看看灵感</Button> : null}</Empty> : null}
    <div className="hair-zone-grid">{query.data?.items.map(style => <Card
      key={`${style.id}:${style.version}`}
      className="outfit-inspiration-card"
      hoverable
      cover={<Button type="text" className="outfit-inspiration-cover-button" aria-label={`查看${style.name}`} onClick={() => setDetailId(style.id)}><Cover style={style} /></Button>}
      actions={[<div className="outfit-inspiration-actions" key="favorite">{style.availability === 'UNAVAILABLE' ? <Tag>已下架</Tag> : <Typography.Text type="secondary">AI 穿搭示意</Typography.Text>}{favoriteButton(style)}</div>]}
    >
      <Card.Meta
        title={<Button type="text" className="outfit-inspiration-title" onClick={() => setDetailId(style.id)}>{style.name}</Button>}
        description={<Space size={[4, 6]} wrap><Tag>{outfitLabels.occasion[style.primaryOccasion]}</Tag><Tag>{outfitLabels.style[style.styles[0]]}</Tag></Space>}
      />
    </Card>)}</div>
    {query.data && query.data.total > 0 ? <Pagination className="hair-pagination" current={query.data.page} pageSize={query.data.pageSize} total={query.data.total} showSizeChanger pageSizeOptions={[12, 24]} showTotal={total => `共 ${total} 款`} onChange={(nextPage, nextSize) => change({ page: String(nextSize === pageSize ? nextPage : 1), pageSize: String(nextSize) })} /> : null}
    <Drawer title="穿搭详情" open={!!detailId} onClose={() => setDetailId(null)} size={560} footer={detail.data ? <Space wrap>{favoriteButton(detail.data)}<Button type="primary" disabled={detail.data.availability !== 'AVAILABLE' || detail.isError || detail.isFetching} onClick={() => detail.data && tryStyle(detail.data)}>用我的衣服搭</Button></Space> : null}>
      {detail.isPending ? <Skeleton active /> : detail.isError ? <QueryFailure error={detail.error} stale={!!detail.data} loading={detail.isFetching} retry={() => void detail.refetch()} /> : detail.data ? <div className="hair-style-detail">{detail.data.availability === 'UNAVAILABLE' ? <Alert className="feature-notice" showIcon type="warning" title="此灵感已下架，暂不能试用" description="可以取消收藏；已经生成的历史效果不受影响。" /> : null}<OutfitReferenceCard value={detail.data} /></div> : null}
    </Drawer>
  </section>;
}

export function OutfitRecordsPage({ accountId }: { accountId: string }) {
  const [page, setPage] = usePageState(`${accountId}:outfit-records`, 'page', 1);
  const [status, setStatus] = usePageState(`${accountId}:outfit-records`, 'status', '');
  const query = useRecords(accountId, page, 'OUTFIT', status, 'design');
  usePageBounds(query.data?.total, 20, query.isSuccess && !query.isFetching, setPage);
  return <section className="outfit-inspiration-zone"><PageHeading title="穿搭设计" description="回看尝试过的造型，继续下一次探索。" /><OutfitNavigation records /><div className="hair-zone-toolbar"><Select aria-label="穿搭任务状态" value={status} onChange={value => { setStatus(value); setPage(1); }} options={[['', '全部状态'], ['QUEUED', '等待中'], ['PLANNING', '正在规划'], ['GENERATING', '正在生成效果图'], ['SAVING', '正在保存结果'], ['SUCCEEDED', '已完成'], ['FAILED', '失败'], ['UNKNOWN', '结果待确认']].map(([value, label]) => ({ value, label }))} /><Space wrap><Button loading={query.isFetching} onClick={() => void query.refetch()}>刷新记录</Button><Button type="primary" href="/app/outfit-design">去挑选穿搭</Button></Space></div>{query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}{query.isPending ? <Skeleton active /> : null}{query.data?.items.length === 0 && !query.isError ? <Empty description={status ? '没有符合条件的穿搭记录' : '还没有穿搭设计记录'} /> : null}<div className="recent-task-grid">{query.data?.items.map(task => <TaskCard key={task.id} task={task} accountId={accountId} origin="outfit-design" />)}</div>{query.data ? <Pagination className="records-pagination" current={page} pageSize={20} total={query.data.total} showSizeChanger={false} onChange={setPage} showTotal={total => `共 ${total} 条记录`} /> : null}</section>;
}
