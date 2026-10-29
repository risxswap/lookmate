import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Collapse, Drawer, Empty, Form, Input, Pagination, Radio, Select, Skeleton, Typography } from 'antd';
import { request } from '../../api/client';
import { PrivateImage } from '../wardrobe/PrivateImage';
import type { DesignInput, HairstyleReference } from './api';
import { chooseHairstyle, hairDraft, restoreHairDraft, type HairDraft, type HairPath } from './hairstyleDraft';
import { HairImages, HairstyleReferenceCard, hairLabels } from './HairstyleReference';
import './hairstyle.css';

interface Props {
  accountId: string; input: DesignInput; patch: (value: Partial<DesignInput>) => void;
  initialReference?: HairstyleReference | null; restoring: boolean; disabled: boolean;
  hasPendingUpload: boolean; previewLoading: boolean; photoError: boolean;
  onPhoto: () => void; onPreview: () => void;
}
type CatalogPage = { items: HairstyleReference[]; page: number; pageSize: number; total: number };
type Filters = { length?: string; bangs?: string; texture?: string };

function HairstyleGallery({ accountId, selectedId, disabled, active, onSelect }: { accountId: string; selectedId?: string | null; disabled: boolean; active: boolean; onSelect: (value: HairstyleReference) => void }) {
  const [filters, setFilters] = useState<Filters>({});
  const [pagination, setPagination] = useState({ page: 1, pageSize: 12 });
  const [detailId, setDetailId] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(pagination.page), pageSize: String(pagination.pageSize) });
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  const query = useQuery({ queryKey: ['hairstyles', accountId, params.toString()], queryFn: ({ signal }) => request<CatalogPage>(`/hairstyles?${params}`, { signal }), enabled: active });
  const detail = useQuery({ queryKey: ['hairstyle', accountId, detailId], queryFn: ({ signal }) => request<HairstyleReference>(`/hairstyles/${encodeURIComponent(detailId!)}`, { signal }), enabled: !!detailId && active });
  function filter(key: keyof Filters, value: string | undefined) { setFilters(current => ({ ...current, [key]: value })); setPagination(current => ({ ...current, page: 1 })); }
  return <>
    <div className="hair-gallery-intro"><Typography.Title level={3}>从一个喜欢的造型开始</Typography.Title><Typography.Paragraph type="secondary">可以大胆尝试，也可以在选中后调整细节。发型示意图由 AI 生成。</Typography.Paragraph></div>
    <div className="hair-filters">{(['length', 'bangs', 'texture'] as const).map(key => <div key={key}><label id={`hair-filter-${key}`}>{({ length: '长度', bangs: '刘海', texture: '卷直' })[key]}</label><Select aria-labelledby={`hair-filter-${key}`} value={filters[key]} allowClear placeholder="全部" disabled={disabled} onChange={value => filter(key, value)} options={Object.entries(hairLabels[key]).map(([value, label]) => ({ value, label }))} /></div>)}</div>
    {query.isPending ? <div className="hair-gallery-grid" aria-label="正在加载发型">{Array.from({ length: 6 }, (_, index) => <Skeleton.Image key={index} active />)}</div> : query.isError ? <Alert showIcon type="error" title="发型图库暂时无法读取" description={query.error.message} action={<Button onClick={() => void query.refetch()} loading={query.isFetching}>重试</Button>} /> : !query.data.items.length ? <Empty description="暂无符合筛选条件的发型"><Button disabled={disabled} onClick={() => { setFilters({}); setPagination(current => ({ ...current, page: 1 })); }}>清除筛选</Button></Empty> : <div className="hair-gallery-grid">{query.data.items.map(style => <Button key={style.id} className={`hair-style-card${selectedId === style.id ? ' is-selected' : ''}`} disabled={disabled} onClick={() => setDetailId(style.id)} aria-label={`查看${style.name}${selectedId === style.id ? '，已选' : ''}`}>
      <div className="hair-style-photo">{style.images[0] ? <img src={style.images[0].url} alt={`${style.name}发型示意图`} loading="lazy" /> : <span>暂无图片</span>}{selectedId === style.id ? <span className="hair-selected-label">已选</span> : null}</div>
      <span className="hair-style-name">{style.name}</span><span className="hair-style-tags">{[hairLabels.length[style.length], hairLabels.bangs[style.bangs], hairLabels.texture[style.texture]].filter(Boolean).join(' · ')}</span>
    </Button>)}</div>}
    {query.data && !query.isError && query.data.total > 0 ? <Pagination className="hair-pagination" current={query.data.page} pageSize={query.data.pageSize} total={query.data.total} showSizeChanger pageSizeOptions={[6, 12, 24]} disabled={disabled || query.isFetching} showTotal={total => `共 ${total} 款`} onChange={(page, pageSize) => setPagination({ page, pageSize })} /> : null}
    <Drawer title="发型详情" open={!!detailId} onClose={() => setDetailId(null)} size={520} footer={<Button type="primary" block size="large" disabled={disabled || !detail.data || detail.isError || detail.isFetching} onClick={() => { if (detail.data) { onSelect(detail.data); setDetailId(null); } }}>选这个发型</Button>}>
      {detail.isPending ? <Skeleton active /> : detail.isError ? <Alert type="error" showIcon title="发型详情无法读取" description={detail.error.message} action={<Button loading={detail.isFetching} onClick={() => void detail.refetch()}>重试</Button>} /> : detail.data ? <div className="hair-style-detail"><HairImages key={`${detail.data.id}-${detail.data.version}`} value={detail.data} large /><Typography.Title level={3}>{detail.data.name}</Typography.Title><Typography.Paragraph type="secondary">{[hairLabels.length[detail.data.length], hairLabels.bangs[detail.data.bangs], hairLabels.texture[detail.data.texture]].filter(Boolean).join(' · ')}</Typography.Paragraph><Typography.Paragraph>{detail.data.description}</Typography.Paragraph><Typography.Title level={5}>日常打理</Typography.Title><Typography.Paragraph>{detail.data.careAdvice}</Typography.Paragraph><Typography.Text type="secondary">这是造型参考，实际修剪与打理方式可结合你的情况和理发师沟通。</Typography.Text></div> : null}
    </Drawer>
  </>;
}

export function HairstyleStudio({ accountId, input, patch, initialReference, restoring, disabled, hasPendingUpload, previewLoading, photoError, onPhoto, onPreview }: Props) {
  const [path, setPath] = useState<HairPath>(() => restoring && !input.hairstyleId ? 'FREE' : 'GALLERY');
  const drafts = useRef<Record<HairPath, HairDraft>>({ GALLERY: hairDraft(input), FREE: { requirements: '', occasion: '', style: '', hairstyleId: null, hairstyleVersion: null, useReferenceHairColor: false } });
  const [selected, setSelected] = useState<HairstyleReference | null>(initialReference || null);
  const selectedQuery = useQuery({ queryKey: ['hairstyle', accountId, input.hairstyleId], queryFn: ({ signal }) => request<HairstyleReference>(`/hairstyles/${encodeURIComponent(input.hairstyleId!)}`, { signal }), enabled: !!input.hairstyleId && path === 'GALLERY' });
  const candidate = selected && selected.id === input.hairstyleId && selected.version === input.hairstyleVersion ? selected : selectedQuery.data?.version === input.hairstyleVersion ? selectedQuery.data : null;
  function changePath(next: HairPath) {
    drafts.current[path] = hairDraft(input);
    setPath(next); patch(restoreHairDraft(next, drafts.current[next]));
  }
  const update = (value: Partial<DesignInput>) => patch({ ...value, constraintOverrides: [] });
  const missingTarget = path === 'GALLERY' && !input.hairstyleId;
  const instructions = <Form.Item className="hair-requirements-item" label={path === 'GALLERY' ? '想调整的地方' : '这次想尝试什么？'} htmlFor="hair-requirements" extra={path === 'GALLERY' ? '你的明确要求优先于参考款，其余部分尽量还原。' : '选填。没有明确想法，也可以参考你的个人偏好设计。'}><Input.TextArea id="hair-requirements" value={input.requirements} onChange={e => update({ requirements: e.target.value })} rows={3} maxLength={2000} showCount placeholder={path === 'GALLERY' ? '例如：保留这个轮廓，但不要刘海……' : '例如：想试试利落的短发，每天容易打理……'} /></Form.Item>;
  const preferences = <><Form.Item label="想尝试的风格" htmlFor="hair-style"><Input id="hair-style" value={input.style} onChange={e => update({ style: e.target.value })} maxLength={100} placeholder="例如：自然、复古、利落" /></Form.Item><Form.Item label="使用场合" htmlFor="hair-occasion"><Input id="hair-occasion" value={input.occasion} onChange={e => update({ occasion: e.target.value })} maxLength={100} placeholder="留空按日常设计" /></Form.Item></>;
  return <div className="hair-studio">
    <section className="hair-catalog" aria-label="挑选发型与自由设计">
      <Radio.Group className="hair-paths" aria-label="发型设计方式" optionType="button" buttonStyle="solid" value={path} disabled={disabled} options={[{ value: 'GALLERY', label: '挑选发型' }, { value: 'FREE', label: '让 AI 帮我设计' }]} onChange={e => changePath(e.target.value)} />
      <div hidden={path !== 'GALLERY'}><HairstyleGallery accountId={accountId} active={path === 'GALLERY'} selectedId={input.hairstyleId} disabled={disabled} onSelect={value => { setSelected(value); patch(chooseHairstyle(value.id, value.version)); }} /></div>
      {path === 'FREE' ? <div className="hair-free-design"><Typography.Title level={3}>聊聊你想尝试的自己</Typography.Title><Typography.Paragraph type="secondary">从你的照片和偏好出发，寻找新的发型灵感。</Typography.Paragraph><Form layout="vertical" disabled={disabled}>{instructions}{preferences}</Form><Alert type="info" showIcon title="也可以大胆尝试" description="短发也能预览长发造型。实际修剪、留长或打理条件，以具体建议和理发师判断为准。" /></div> : null}
    </section>
    <aside className="hair-design-summary" aria-label="本次发型设计">
      <div className="hair-summary-heading"><Typography.Title level={3}>本次设计</Typography.Title><Typography.Text type="secondary">一套方案，一张效果图</Typography.Text></div>
      <div className="hair-person"><div className="hair-section-heading"><strong>本人照片</strong><Button size="small" disabled={disabled} onClick={onPhoto}>{input.personFileId ? '更换照片' : '添加照片'}</Button></div>{input.personFileId ? <PrivateImage accountId={accountId} fileId={input.personFileId} alt="本次设计使用的本人照片" hideRefresh /> : <div className="hair-person-empty"><Typography.Paragraph>先挑选喜欢的款式也可以。</Typography.Paragraph><Typography.Text type="secondary">生成前添加一张面部和头发清晰的照片。</Typography.Text></div>}{photoError ? <Alert type="warning" title="默认照片读取失败，请手动添加。" /> : null}</div>
      {path === 'GALLERY' ? <div className="hair-selected-target"><div className="hair-section-heading"><strong>目标发型</strong><span>同款多角度参考</span></div>{candidate ? <HairstyleReferenceCard value={candidate} /> : input.hairstyleId ? <Typography.Paragraph type="secondary">{selectedQuery.isPending ? '正在读取所选发型……' : '原款式信息暂不可用，请从图库重新选择。'}</Typography.Paragraph> : <Typography.Paragraph type="secondary">在左侧选择一个喜欢的发型。</Typography.Paragraph>}{input.hairstyleId && (selectedQuery.isError || selectedQuery.data && selectedQuery.data.version !== input.hairstyleVersion) ? <Alert showIcon type="warning" title="所选款式需要重新核验" description="款式可能已更新或暂不可用。可以重新选择；原来的照片和要求会保留。" /> : null}<Checkbox checked={!!input.useReferenceHairColor} disabled={disabled || !input.hairstyleId} onChange={e => update({ useReferenceHairColor: e.target.checked })}>同时尝试参考发色</Checkbox><Typography.Paragraph className="hair-color-note" type="secondary">默认保留本人发色。</Typography.Paragraph><Form layout="vertical" disabled={disabled}>{instructions}<Collapse ghost items={[{ key: 'more', label: '更多设计条件', children: preferences }]} /></Form></div> : <Typography.Paragraph className="hair-free-summary">由 AI 结合本人照片、本次想法和个人偏好设计，不使用图库款式。</Typography.Paragraph>}
      <div className="hair-submit"><Button type="primary" size="large" block loading={previewLoading} disabled={disabled || missingTarget || !input.personFileId || hasPendingUpload} onClick={onPreview}>继续，确认设计</Button><Typography.Paragraph type="secondary">{hasPendingUpload ? '请等待上传完成，或移除未完成的上传。' : missingTarget ? '先选择目标发型，或切换为让 AI 帮我设计。' : !input.personFileId ? '添加本人照片后即可继续。' : '下一步核对照片、调整要求与本次限制。'}</Typography.Paragraph></div>
    </aside>
  </div>;
}
