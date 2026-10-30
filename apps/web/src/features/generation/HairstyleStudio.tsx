import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Collapse, Form, Input, Space, Typography } from 'antd';
import { request } from '../../api/client';
import { PrivateImage } from '../wardrobe/PrivateImage';
import type { Hairstyle } from '../hairstyles/queries';
import { hairGalleryReturn, type HairstylePath } from '../hairstyles/drafts';
import type { DesignInput, HairstyleReference } from './api';
import { HairImages, hairLabels } from './HairstyleReference';
import './hairstyle.css';
import '../hairstyles/hairstyles.css';

interface Props {
  accountId: string; input: DesignInput; patch: (value: Partial<DesignInput>) => void;
  path: HairstylePath; initialReference?: HairstyleReference | null;
  disabled: boolean; hasPendingUpload: boolean; previewLoading: boolean; photoError: boolean;
  onPhoto: () => void; onPreview: () => void;
}
export function HairstyleStudio({ accountId, input, patch, path, initialReference, disabled, hasPendingUpload, previewLoading, photoError, onPhoto, onPreview }: Props) {
  const gallery = path === 'gallery';
  const galleryHref = hairGalleryReturn(accountId).href;
  const selected = useQuery({ queryKey: ['hairstyle', accountId, input.hairstyleId], queryFn: ({ signal }) => request<Hairstyle>(`/hairstyles/${encodeURIComponent(input.hairstyleId!)}`, { signal }), enabled: gallery && !!input.hairstyleId });
  const reference = selected.data?.version === input.hairstyleVersion ? selected.data : initialReference && initialReference.id === input.hairstyleId && initialReference.version === input.hairstyleVersion ? initialReference : null;
  const unavailable = gallery && (!input.hairstyleId || selected.isError || selected.isPending || selected.isFetching || selected.data?.availability !== 'AVAILABLE' || selected.data?.version !== input.hairstyleVersion);
  const update = (value: Partial<DesignInput>) => patch({ ...value, constraintOverrides: [] });
  const instructions = <Form.Item className="hair-requirements-item" label={gallery ? '想调整的地方' : '这次想尝试什么？'} htmlFor="hair-requirements" extra={gallery ? '你的明确要求优先于参考款，其余部分尽量还原。' : '选填。没有明确想法，也可以参考你的个人偏好设计。'}><Input.TextArea id="hair-requirements" value={input.requirements} onChange={e => update({ requirements: e.target.value })} rows={4} maxLength={2000} showCount placeholder={gallery ? '例如：保留这个轮廓，但不要刘海……' : '例如：想试试利落的短发，每天容易打理……'} /></Form.Item>;
  const preferences = <><Form.Item label="想尝试的风格" htmlFor="hair-style"><Input id="hair-style" value={input.style} onChange={e => update({ style: e.target.value })} maxLength={100} placeholder="例如：自然、复古、利落" /></Form.Item><Form.Item label="使用场合" htmlFor="hair-occasion"><Input id="hair-occasion" value={input.occasion} onChange={e => update({ occasion: e.target.value })} maxLength={100} placeholder="留空按日常设计" /></Form.Item></>;
  return <>
    <Space wrap className="hair-trial-nav"><Button disabled={disabled} href={galleryHref}>返回图库</Button><Button disabled={disabled} href={`/app/hairstyles/try?path=${gallery ? 'free' : 'gallery'}`}>{gallery ? '切换为 AI 自由设计' : '继续图库选款设计'}</Button><Button href="/app/hairstyles/records">我的发型记录</Button></Space>
    <div className="hair-studio hair-trial-studio">
      <section className="hair-trial-reference" aria-label={gallery ? '目标发型' : '自由设计要求'}>
        {gallery ? <><div className="hair-section-heading"><Typography.Title level={3}>{reference?.name || '本次目标发型'}</Typography.Title><Button href={galleryHref} disabled={disabled}>更换款式</Button></div>{reference ? <><HairImages key={`${reference.id}:${reference.version}`} value={reference} large /><Typography.Paragraph type="secondary">{[hairLabels.length[reference.length], hairLabels.bangs[reference.bangs], hairLabels.texture[reference.texture]].join(' · ')} · AI 发型示意</Typography.Paragraph><Typography.Paragraph>{reference.description}</Typography.Paragraph></> : <Typography.Paragraph type="secondary">{selected.isPending && input.hairstyleId ? '正在读取目标发型……' : '从图库选择喜欢的款式，照片与已填写要求会保留。'}</Typography.Paragraph>}{unavailable && input.hairstyleId && !selected.isPending ? <Alert showIcon type="warning" title={selected.data?.availability === 'UNAVAILABLE' ? '目标款式已下架，不能新建试用' : selected.isError ? '目标款式暂时无法读取' : '目标款式需要重新核验'} description="请重新查看款式或选择另一款。本人的照片和要求会保留，系统不会自动替换参考图。" action={<Button disabled={disabled} onClick={() => void selected.refetch()}>重新核验</Button>} /> : null}</> : <div className="hair-free-design"><Typography.Title level={3}>聊聊你想尝试的自己</Typography.Title><Typography.Paragraph type="secondary">从你的照片和偏好出发，寻找新的发型灵感。</Typography.Paragraph><Form layout="vertical" disabled={disabled}>{instructions}{preferences}</Form><Alert type="info" showIcon title="也可以大胆尝试" description="短发也能预览长发造型。实际修剪、留长或打理条件，以具体建议和理发师判断为准。" /></div>}
      </section>
      <aside className="hair-design-summary" aria-label="本次发型设计">
        <div className="hair-summary-heading"><Typography.Title level={3}>本次设计</Typography.Title><Typography.Text type="secondary">一套方案，一张效果图</Typography.Text></div>
        <div className="hair-person"><div className="hair-section-heading"><strong>本人照片</strong><Button size="small" disabled={disabled} onClick={onPhoto}>{input.personFileId ? '更换照片' : '添加照片'}</Button></div>{input.personFileId ? <PrivateImage accountId={accountId} fileId={input.personFileId} alt="本次设计使用的本人照片" hideRefresh /> : <div className="hair-person-empty">添加一张面部和头发清晰的照片。</div>}{photoError ? <Alert type="warning" title="默认照片读取失败，请手动添加。" /> : null}</div>
        {gallery ? <div className="hair-selected-target"><Checkbox checked={!!input.useReferenceHairColor} disabled={disabled || !input.hairstyleId} onChange={e => update({ useReferenceHairColor: e.target.checked })}>同时尝试参考发色</Checkbox><Typography.Paragraph className="hair-color-note" type="secondary">默认保留本人发色。</Typography.Paragraph><Form layout="vertical" disabled={disabled}>{instructions}<Collapse ghost items={[{ key: 'more', label: '更多设计条件', children: preferences }]} /></Form></div> : <Typography.Paragraph className="hair-free-summary">由 AI 结合本人照片、本次想法和个人偏好设计，不使用图库款式。</Typography.Paragraph>}
        <div className="hair-submit"><Button type="primary" size="large" block loading={previewLoading} disabled={disabled || unavailable || !input.personFileId || hasPendingUpload} onClick={onPreview}>继续，确认设计</Button><Typography.Paragraph type="secondary">{hasPendingUpload ? '请等待上传完成，或移除未完成的上传。' : unavailable ? '请先确认可用的目标款式，或切换为 AI 自由设计。' : !input.personFileId ? '添加本人照片后即可继续。' : '下一步核对照片、调整要求与本次限制。'}</Typography.Paragraph></div>
      </aside>
    </div>
  </>;
}
