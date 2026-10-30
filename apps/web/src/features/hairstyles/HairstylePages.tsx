import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Drawer, Empty, Pagination, Radio, Select, Skeleton, Space, Tabs, Tag, Typography } from 'antd';
import { request } from '../../api/client';
import { navigate, useLocation, usePageState } from '../../app/navigation';
import { PageHeading } from '../../components/PageHeading';
import { HairImages, hairLabels } from '../generation/HairstyleReference';
import { QueryFailure, TaskCard } from '../workspace/TaskViews';
import { usePageBounds, useRecords, type Page } from '../designs/queries';
import { type Hairstyle, useHairstyleFavorite } from './queries';
import { hairGalleryReturn, readHairDraft, rememberHairGallery } from './drafts';
import '../generation/hairstyle.css';
import './hairstyles.css';

export function HairstyleNavigation({ records = false }: { records?: boolean }) {
  return <Tabs activeKey={records ? 'records' : 'gallery'} items={[{ key: 'gallery', label: '发型图库' }, { key: 'records', label: '我的发型记录' }]} onChange={key => navigate(new URL(key === 'records' ? '/app/hairstyles/records' : '/app/hairstyles', window.location.origin))} />;
}
function Cover({ style }: { style: Hairstyle }) {
  const [failed, setFailed] = useState(false);
  return <div className="hair-style-photo">{style.images[0] && !failed ? <img src={style.images[0].url} alt={`${style.name}发型示意图`} loading="lazy" onError={() => setFailed(true)} /> : <span>暂无参考图片</span>}</div>;
}
const positive = (value: string | null, fallback: number) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : fallback;
export function HairstyleGalleryPage({ accountId }: { accountId: string }) {
  const location = useLocation();
  const scope = location.searchParams.get('scope') === 'favorites' ? 'favorites' : 'all';
  const page = positive(location.searchParams.get('page'), 1);
  const pageSize = [6, 12, 24].includes(Number(location.searchParams.get('pageSize'))) ? Number(location.searchParams.get('pageSize')) : 12;
  const filters = Object.fromEntries((['length', 'bangs', 'texture'] as const).map(key => [key, location.searchParams.get(key) || undefined]));
  const params = new URLSearchParams({ scope, page: String(page), pageSize: String(pageSize) });
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  const query = useQuery({ queryKey: ['hairstyles', accountId, params.toString()], queryFn: ({ signal }) => request<Page<Hairstyle>>(`/hairstyles?${params}`, { signal }) });
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['hairstyle', accountId, detailId], queryFn: ({ signal }) => request<Hairstyle>(`/hairstyles/${encodeURIComponent(detailId!)}`, { signal }), enabled: !!detailId });
  const favorite = useHairstyleFavorite(accountId);
  const previousGallery = hairGalleryReturn(accountId);
  const galleryHref = location.pathname + location.search;
  const [scroll, setScroll] = usePageState(`${accountId}:hair-gallery`, 'scroll', previousGallery.href === galleryHref ? previousGallery.scroll : 0);
  const scrollRef = useRef(scroll);
  const restoredScroll = useRef(false);
  useEffect(() => {
    if (!query.data || restoredScroll.current) return;
    const frame = requestAnimationFrame(() => { window.scrollTo(0, scrollRef.current); restoredScroll.current = true; rememberHairGallery(accountId, galleryHref, scrollRef.current); });
    return () => cancelAnimationFrame(frame);
  }, [query.data, accountId, galleryHref]);
  useEffect(() => { const remember = () => { if (restoredScroll.current) { setScroll(window.scrollY); rememberHairGallery(accountId, galleryHref, window.scrollY); } }; window.addEventListener('scroll', remember); return () => window.removeEventListener('scroll', remember); }, [accountId, galleryHref, setScroll]);
  function change(values: Record<string, string | undefined>) {
    const url = new URL(window.location.href);
    Object.entries(values).forEach(([key, value]) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
    navigate(url, true);
  }
  useEffect(() => { if (query.isSuccess && !query.isFetching && page > Math.max(1, Math.ceil(query.data.total / pageSize))) change({ page: String(Math.max(1, Math.ceil(query.data.total / pageSize))) }); }, [query.isSuccess, query.isFetching, query.data?.total, page, pageSize]);
  useEffect(() => { if (restoredScroll.current) rememberHairGallery(accountId, galleryHref, window.scrollY); }, [accountId, galleryHref]);
  const saved = readHairDraft(accountId, 'gallery') || readHairDraft(accountId, 'free');
  function tryStyle(style: Hairstyle) {
    rememberHairGallery(accountId, galleryHref, window.scrollY);
    const next = new URL('/app/hairstyles/try', window.location.origin);
    next.searchParams.set('path', 'gallery'); next.searchParams.set('hairstyleId', style.id); next.searchParams.set('hairstyleVersion', style.version);
    navigate(next);
  }
  function favoriteButton(style: Hairstyle) {
    return <Button loading={favorite.pendingIds.has(style.id)} disabled={favorite.pendingIds.has(style.id) || !style.favorited && style.availability === 'UNAVAILABLE'} aria-label={`${style.favorited ? '取消收藏' : '收藏款式'}：${style.name}`} aria-pressed={style.favorited} onClick={() => favorite.mutate(style)}>{style.favorited ? '已收藏' : '收藏款式'}</Button>;
  }
  return <section className="hairstyle-zone">
    <PageHeading title="发型设计" description="先挑选喜欢的造型，再看看它在你身上的样子。" />
    <HairstyleNavigation />
    <div className="hair-zone-toolbar"><Space wrap><Radio.Group optionType="button" buttonStyle="solid" value={scope} options={[{ value: 'all', label: '全部款式' }, { value: 'favorites', label: '已收藏' }]} onChange={e => change({ scope: e.target.value, page: '1' })} />{(['length', 'bangs', 'texture'] as const).map(key => <Select key={key} aria-label={({ length: '发型长度', bangs: '刘海', texture: '卷直' })[key]} placeholder={({ length: '全部长度', bangs: '全部刘海', texture: '全部卷直' })[key]} value={filters[key]} allowClear options={Object.entries(hairLabels[key]).map(([value, label]) => ({ value, label }))} onChange={value => change({ [key]: value, page: '1' })} />)}</Space><Space wrap>{saved ? <Button href={`/app/hairstyles/try?path=${readHairDraft(accountId, 'gallery') ? 'gallery' : 'free'}`}>继续未提交设计</Button> : null}<Button type="primary" href="/app/hairstyles/try?path=free">AI 自由设计</Button></Space></div>
    <Typography.Paragraph type="secondary" className="hair-zone-note">款式图片为 AI 发型示意，可查看正面、侧面与背面。长度按披散后的头发归类。</Typography.Paragraph>
    {favorite.isError ? <Alert className="feature-notice" type="error" showIcon title="收藏操作未完成" description={favorite.error.message} action={<Button onClick={() => favorite.variables && favorite.mutate(favorite.variables)}>重试</Button>} /> : null}
    {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
    {query.isPending ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
    {query.data?.items.length === 0 && !query.isError ? <Empty description={Object.values(filters).some(Boolean) ? '暂无符合筛选条件的发型' : scope === 'favorites' ? '还没有收藏的发型' : '暂无可用款式'}>{Object.values(filters).some(Boolean) ? <Button onClick={() => change({ length: undefined, bangs: undefined, texture: undefined, page: '1' })}>清除筛选</Button> : scope === 'favorites' ? <Button onClick={() => change({ scope: 'all', page: '1' })}>去看看款式</Button> : null}</Empty> : null}
    <div className="hair-zone-grid">{query.data?.items.map(style => <Card
      key={`${style.id}:${style.version}`}
      className="hair-catalog-card"
      hoverable
      cover={<Button type="text" className="hair-catalog-cover-button" aria-label={`查看${style.name}`} onClick={() => setDetailId(style.id)}><Cover style={style} /></Button>}
      actions={[<div className="hair-catalog-actions" key="favorite">{style.availability === 'UNAVAILABLE' ? <Tag>已下架</Tag> : <Typography.Text type="secondary">AI 发型示意</Typography.Text>}{favoriteButton(style)}</div>]}
    >
      <Card.Meta
        title={<Button type="text" className="hair-catalog-title" onClick={() => setDetailId(style.id)}>{style.name}</Button>}
        description={<Space size={[4, 6]} wrap><Tag>{hairLabels.length[style.length]}</Tag><Tag>{hairLabels.bangs[style.bangs]}</Tag><Tag>{hairLabels.texture[style.texture]}</Tag></Space>}
      />
    </Card>)}</div>
    {query.data && query.data.total > 0 ? <Pagination className="hair-pagination" current={query.data.page} pageSize={query.data.pageSize} total={query.data.total} showSizeChanger pageSizeOptions={[6, 12, 24]} showTotal={total => `共 ${total} 款`} onChange={(nextPage, nextSize) => change({ page: String(nextSize === pageSize ? nextPage : 1), pageSize: String(nextSize) })} /> : null}
    <Drawer title="发型详情" open={!!detailId} onClose={() => setDetailId(null)} size={520} footer={detail.data ? <Space wrap>{favoriteButton(detail.data)}<Button type="primary" disabled={detail.data.availability !== 'AVAILABLE' || detail.isError || detail.isFetching} onClick={() => detail.data && tryStyle(detail.data)}>试这个发型</Button></Space> : null}>
      {detail.isPending ? <Skeleton active /> : detail.isError ? <QueryFailure error={detail.error} stale={!!detail.data} loading={detail.isFetching} retry={() => void detail.refetch()} /> : detail.data ? <div className="hair-style-detail">{detail.data.availability === 'UNAVAILABLE' ? <Alert className="feature-notice" showIcon type="warning" title="此款式已下架，暂不能试用" description="可以取消收藏；已经生成的历史效果不受影响。" /> : null}<HairImages key={`${detail.data.id}:${detail.data.version}`} value={detail.data} large /><Typography.Title level={3}>{detail.data.name}</Typography.Title><Typography.Paragraph>{detail.data.description}</Typography.Paragraph><Typography.Title level={5}>日常打理</Typography.Title><Typography.Paragraph>{detail.data.careAdvice}</Typography.Paragraph><Typography.Text type="secondary">这是造型参考，实际修剪和打理可结合你的情况与理发师沟通。</Typography.Text></div> : null}
    </Drawer>
  </section>;
}

export function HairstyleRecordsPage({ accountId }: { accountId: string }) {
  const [page, setPage] = usePageState(`${accountId}:hair-records`, 'page', 1);
  const [status, setStatus] = usePageState(`${accountId}:hair-records`, 'status', '');
  const query = useRecords(accountId, page, 'HAIRSTYLE', status);
  usePageBounds(query.data?.total, 20, query.isSuccess && !query.isFetching, setPage);
  return <section className="hairstyle-zone"><PageHeading title="发型设计" description="回看尝试过的造型，继续下一次探索。" /><HairstyleNavigation records /><div className="hair-zone-toolbar"><Select aria-label="发型任务状态" value={status} onChange={value => { setStatus(value); setPage(1); }} options={[['', '全部状态'], ['QUEUED', '等待中'], ['PLANNING', '正在规划'], ['GENERATING', '正在生成效果图'], ['SAVING', '正在保存结果'], ['SUCCEEDED', '已完成'], ['FAILED', '失败'], ['UNKNOWN', '结果待确认']].map(([value, label]) => ({ value, label }))} /><Space wrap><Button loading={query.isFetching} onClick={() => void query.refetch()}>刷新记录</Button><Button type="primary" href="/app/hairstyles">去挑选发型</Button></Space></div>{query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}{query.isPending ? <Skeleton active /> : null}{query.data?.items.length === 0 && !query.isError ? <Empty description={status ? '没有符合条件的发型记录' : '还没有发型设计记录'} /> : null}<div className="recent-task-grid">{query.data?.items.map(task => <TaskCard key={task.id} task={task} accountId={accountId} origin="hairstyles" />)}</div>{query.data ? <Pagination className="records-pagination" current={page} pageSize={20} total={query.data.total} showSizeChanger={false} onChange={setPage} showTotal={total => `共 ${total} 条记录`} /> : null}</section>;
}
