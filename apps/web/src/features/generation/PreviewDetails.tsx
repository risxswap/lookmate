import { Alert, Checkbox, Collapse, Descriptions, Space, Typography } from 'antd';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { measurementGroups } from '../profile/queries';
import { dictionaries, type PreferenceTag } from '../profile/preferences';
import type { PersonalContext, Preview } from './api';
import { OutfitReferenceCard } from '../outfitInspirations/OutfitReference';
import '../outfitInspirations/outfits.css';
import { HairstyleReferenceCard } from './HairstyleReference';
import { restrictionChoices } from './hairstyleDraft';
import './hairstyle.css';

const tagNames = (values: PreferenceTag[] | undefined, dictionary: Record<string, string>) => values?.map(v => v.type === 'CUSTOM' ? v.text : dictionary[v.code] || v.code).join('、') || '未提供';
export function ContextDetails({ value }: { value: PersonalContext }) {
  const p = value.preferences;
  const measurements = measurementGroups.flatMap(group => group.fields.map(([key, label]) => value.measurements?.[key] == null ? null : `${label} ${value.measurements[key]} ${key === 'weight' ? 'kg' : 'cm'}`).filter(Boolean)).join('；');
  return <Descriptions column={1} size="small" items={[
    { key: 'gender', label: '性别 / 年龄', children: `${value.gender === 'FEMALE' ? '女' : value.gender === 'MALE' ? '男' : '性别未提供'} / ${value.age == null ? '年龄未提供' : `${value.age} 岁`}` },
    { key: 'measurements', label: '本次尺寸', children: measurements || '不使用有效尺寸' },
    { key: 'interests', label: '兴趣', children: tagNames(p?.interests, dictionaries.interests) },
    { key: 'styles', label: '喜欢的风格', children: tagNames(p?.styles, dictionaries.styles) },
    { key: 'colors', label: '喜欢 / 不喜欢的颜色', children: `${tagNames(p?.preferredColors, dictionaries.colors)} / ${tagNames(p?.avoidedColors, dictionaries.colors)}` },
    { key: 'fits', label: '版型偏好', children: p?.fits?.map(v => dictionaries.fits[v as keyof typeof dictionaries.fits] || v).join('、') || '未提供' },
    { key: 'hair', label: '发型偏好', children: `${p?.hairLengths?.map(v => dictionaries.hairLengths[v as keyof typeof dictionaries.hairLengths] || v).join('、') || '长度未提供'}；染发：${p?.dyeAcceptance === 'ACCEPT' ? '接受' : p?.dyeAcceptance === 'REJECT' ? '不接受' : '未提供'}；烫发：${p?.permAcceptance === 'ACCEPT' ? '接受' : p?.permAcceptance === 'REJECT' ? '不接受' : '未提供'}` },
    { key: 'grooming', label: '打理投入', children: ({ LOW: '少量', MEDIUM: '适中', HIGH: '较多' } as Record<string, string>)[p?.groomingEffort || ''] || '未提供' },
    { key: 'notes', label: '长期补充', children: <div className="task-text">{[p?.outfitNote, p?.hairNote, p?.restrictionNote].filter(Boolean).join('\n') || '未提供'}</div> },
  ]} />;
}
export function PreviewDetails({ includesOutfit, accountId, value, overrides, onOverrides, disabled = false }: { includesOutfit: boolean; accountId: string; value: Preview; overrides: string[]; disabled?: boolean; onOverrides: (ids: string[]) => void }) {
  const choices = restrictionChoices(value.restrictions, value.conflicts, overrides);
  const exceptionChoices = includesOutfit ? value.restrictions : choices.direct;
  const exceptionCheckbox = (r: Preview['restrictions'][number]) => <Checkbox disabled={disabled} key={r.id} checked={overrides.includes(r.id)} onChange={e => onOverrides(e.target.checked ? [...overrides, r.id] : overrides.filter(id => id !== r.id))}>仅本次允许突破：{r.text}</Checkbox>;
  return <Space orientation="vertical" size="middle" className="generation-preview">
    <Typography.Paragraph>请核对本次照片、{includesOutfit ? '资料和必穿单品' : '目标发型与调整要求'}。提交后将在后台继续，不需要停留在此页面。</Typography.Paragraph>
    <div className="generation-confirm-photo"><PrivateImage accountId={accountId} fileId={value.personPhoto.fileId} alt="本次使用的本人照片" /></div>
    {value.outfitInspirationReference ? <OutfitReferenceCard value={value.outfitInspirationReference} /> : null}{value.hairstyleReference ? <section className="hair-confirm-target"><h4>本次目标发型</h4><HairstyleReferenceCard value={value.hairstyleReference} /></section> : null}
    <Collapse items={[{ key: 'context', label: '查看完整个人资料与尺寸', children: <ContextDetails value={value.personalContext} /> }]} />
    {includesOutfit ? <><Typography.Text strong>必穿单品</Typography.Text>
    {value.requiredDresses.length ? <div className="generation-picker-grid">{value.requiredDresses.map(d => <div key={d.dressId}>{d.imageFileIds[0] ? <PrivateImage accountId={accountId} fileId={d.imageFileIds[0]} thumbnail alt={d.dressName} /> : null}<Typography.Text>{d.dressName} · {d.categoryName}</Typography.Text></div>)}</div> : <Typography.Text type="secondary">未指定，由系统从衣橱选择。</Typography.Text>}</> : null}
    {value.restrictions.length ? <><Typography.Text strong>长期明确限制</Typography.Text><Typography.Text type="secondary">{value.restrictions.map(r => r.text).join('；')}。默认遵守，单次例外不修改长期资料。</Typography.Text>{exceptionChoices.map(exceptionCheckbox)}{!includesOutfit && choices.optional.length ? <Collapse items={[{ key: 'optional-exceptions', label: '调整本次限制', children: <Space orientation="vertical"><Typography.Text type="secondary">如果本次想法需要突破其他长期限制，可主动选择。变更后会重新核验。</Typography.Text>{choices.optional.map(exceptionCheckbox)}</Space> }]} /> : null}</> : null}
    {value.conflicts.map((c, i) => <Alert key={`${c.restrictionId}-${i}`} showIcon type="error" title={c.message} description={c.requirementExcerpt} />)}
    {value.notices.map((n, i) => <Alert key={`${n.code}-${i}`} showIcon type={n.severity === 'WARNING' ? 'warning' : 'info'} title={n.message} />)}
    <Typography.Text type="secondary">预览不能穷尽自由文字中的所有冲突。规划时发现无法满足的明确要求会停止并说明原因。</Typography.Text>
  </Space>;
}
