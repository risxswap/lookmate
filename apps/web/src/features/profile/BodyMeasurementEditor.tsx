import { useEffect, useId, useState, type CSSProperties } from 'react';
import { InputNumber, Radio } from 'antd';
import { measurementGroups, type MeasurementKey, type MeasurementValues } from './queries';
import './BodyMeasurementEditor.css';
import { bodySilhouette } from './bodySilhouette';

export type BodyGender = 'FEMALE' | 'MALE';
interface Props {
  gender: BodyGender;
  disabled?: boolean;
  genderUnset?: boolean;
  readOnly?: boolean;
  focusError?: { key: MeasurementKey; attempt: number };
  values: MeasurementValues;
  onGenderChange: (gender: BodyGender) => void;
  onChange: (key: MeasurementKey, value: number | null) => void;
}
const definitions = Object.fromEntries(measurementGroups.flatMap(group => group.fields.map(([key, label, hint]) => [key, { label, hint }]))) as Record<MeasurementKey, { label: string; hint: string }>;
const groups = [
  { label: '常用尺寸', fields: ['height', 'chest', 'waist', 'hip', 'weight'] },
  { label: '躯干与肩背', fields: ['neck', 'shoulder', 'chest', 'underbust', 'waist', 'abdomen', 'hip', 'frontWaistLength'] },
  { label: '手臂', fields: ['armLength', 'upperArm', 'forearm', 'wrist'] },
  { label: '腿部', fields: ['inseam', 'outseam', 'thigh', 'knee', 'calf', 'ankle'] },
  { label: '头部与脚部', fields: ['head', 'leftFootLength', 'leftFootWidth', 'rightFootLength', 'rightFootWidth'] },
] satisfies { label: string; fields: MeasurementKey[] }[];
function Outline({ gender }: { gender: BodyGender; back?: boolean }) {
  return <path className="bme-silhouette" d={bodySilhouette[gender === 'FEMALE' ? 'female' : 'male']} />;
}
function measurementRings(gender: BodyGender): Partial<Record<MeasurementKey, [number, number, number, number]>> {
  const female = gender === 'FEMALE';
  return {
    head: [200, 70, female ? 27 : 28, 6], neck: [200, 123, female ? 18 : 21, 4],
    chest: [200, 197, female ? 44 : 54, 8], underbust: [200, 220, female ? 39 : 49, 7],
    waist: [200, 249, female ? 40 : 49, 7], abdomen: [200, 285, female ? 53 : 52, 8],
    hip: [200, 329, female ? 58 : 60, 9], upperArm: [female ? 146 : 125, 214, female ? 12 : 17, 4],
    forearm: [female ? 132 : 113, 283, female ? 11 : 12, 4], wrist: [female ? 127 : 109, 320, female ? 8 : 9, 3],
    thigh: [female ? 175 : 170, 382, female ? 25 : 27, 6], knee: [female ? 180 : 175, 437, female ? 17 : 18, 5],
    calf: [female ? 179 : 173, 489, female ? 18 : 21, 5], ankle: [female ? 186 : 179, 576, female ? 8 : 10, 3],
  };
}
function measurementLengths(gender: BodyGender, _back: boolean): Partial<Record<MeasurementKey, { path: string; ends: [number, number, number, number] }>> {
  const female = gender === 'FEMALE';
  return {
    height: { path: 'M70 35 V613 M65 35 H75 M65 613 H75', ends: [70, 35, 70, 613] },
    shoulder: { path: female ? 'M145 145 Q200 116 255 145' : 'M127 145 Q200 112 273 145', ends: female ? [145,145,255,145] : [127,145,273,145] },
    backWidth: { path: female ? 'M156 190 H244' : 'M145 190 H255', ends: female ? [156,190,244,190] : [145,190,255,190] },
    frontWaistLength: { path: female ? 'M184 128 Q170 180 175 220 V249' : 'M179 125 Q170 180 175 220 V249', ends: female ? [184,128,175,249] : [179,125,175,249] },
    backWaistLength: { path: 'M200 124 V249', ends: [200,124,200,249] },
    armLength: { path: female ? 'M145 145 Q145 204 139 245 Q130 281 127 320' : 'M127 145 Q129 202 119 245 Q110 282 109 320', ends: female ? [145,145,127,320] : [127,145,109,320] },
    inseam: { path: female ? 'M200 333 Q200 388 197 432 Q192 468 195 505 Q192 555 194 578 V613' : 'M201 336 Q195 382 194 431 Q189 470 193 506 Q185 551 190 578 V613', ends: female ? [200,333,194,613] : [201,336,190,613] },
    outseam: { path: female ? 'M160 249 Q141 297 143 330 Q147 382 162 432 Q158 471 162 505 Q174 551 178 578 V613' : 'M151 249 Q141 294 141 342 Q139 389 157 434 Q150 465 154 506 Q164 549 168 578 V613', ends: female ? [160,249,178,613] : [151,249,168,613] },
  };
}

function MeasureLine({ active, gender, back = false, leader }: { active: MeasurementKey | null; gender: BodyGender; back?: boolean; leader?: { side: 'left' | 'right'; edge: number } }) {
  if (!active) return null;
  const ring = measurementRings(gender)[active];
  if (ring) {
    const [x, y, rx, ry] = ring;
    return <g className="bme-measure">{leader && <path className="bme-leader" d={`M${leader.side === 'left' ? x-rx : x+rx} ${y} H${leader.edge}`} />}<path strokeDasharray="4 4" d={`M${x-rx} ${y} A${rx} ${ry} 0 0 1 ${x+rx} ${y}`} /><path d={`M${x-rx} ${y} A${rx} ${ry} 0 0 0 ${x+rx} ${y}`} /><circle cx={x-rx} cy={y} r="3" /><circle cx={x+rx} cy={y} r="3" /></g>;
  }
  const length = measurementLengths(gender, back)[active];
  const line = length?.path;
  const ends = length?.ends;
  return line && ends ? <g className="bme-measure">{leader && <path className="bme-leader" d={`M${ends[0]} ${ends[1]} H${leader.edge}`} />}<path d={line} /><circle cx={ends[0]} cy={ends[1]} r="3" /><circle cx={ends[2]} cy={ends[3]} r="3" /></g> : null;
}
function Foot({ side, active }: { side: 'left' | 'right'; active: MeasurementKey | null }) {
  const isLength = active === `${side}FootLength`;
  const isWidth = active === `${side}FootWidth`;
  return <svg viewBox="0 0 160 245" role="img" aria-label={`本人${side === 'left' ? '左' : '右'}脚俯视示意图`}><g transform={side === 'right' ? 'translate(160 0) scale(-1 1)' : undefined}><path className="bme-silhouette" d="M95 43 C93 36 93 29 99 26 C105 23 112 26 115 32 C119 40 118 51 119 60 C120 70 123 76 122 83 C121 92 117 99 115 109 C112 123 110 139 111 153 C112 166 108 179 107 191 C105 205 101 217 92 223 C86 227 79 225 74 221 C65 214 61 202 58 188 C55 173 55 159 52 145 C49 129 45 114 42 100 C39 87 39 75 40 67 C40 61 44 57 49 58 L51 61 C49 55 50 50 55 48 C59 46 63 49 64 53 C62 47 62 42 67 39 C72 36 77 39 78 44 C75 37 76 32 81 30 C87 27 92 31 93 37 L95 43 Z" />{isLength && <path className="bme-measure" d="M27 25 V225 M21 25 H33 M21 225 H33" />}{isWidth && <path className="bme-measure" d="M39.5 83 H122 M39.5 77 V89 M122 77 V89" />}</g></svg>;
}

export function BodyMeasurementEditor({ gender, values, onGenderChange, onChange, disabled = false, readOnly = false, genderUnset = false, focusError }: Props) {
  const id = useId();
  const rings = measurementRings(gender);
  const [group, setGroup] = useState(0);
  const [groupViews, setGroupViews] = useState(() => groups.map(item => ({ back: false, active: item.fields[0] as MeasurementKey })));
  const { back, active } = groupViews[group];
  function setActive(key: MeasurementKey) {
    setGroupViews(previous => previous.map((view, index) => index === group ? { ...view, active: key } : view));
  }
  function setBack(nextBack: boolean) {
    setGroupViews(previous => previous.map((view, index) => index === group ? { back: nextBack, active: nextBack ? 'backWidth' : groups[group].fields[0] } : view));
  }
  useEffect(() => {
    if (!focusError) return;
    const key = focusError.key;
    const isBack = key === 'backWidth' || key === 'backWaistLength';
    const nextGroup = isBack ? 1 : Math.max(0, groups.findIndex(item => (item.fields as MeasurementKey[]).includes(key)));
    setGroup(nextGroup);
    setGroupViews(previous => previous.map((view, index) => index === nextGroup ? { back: isBack, active: key } : view));
    const timer = window.setTimeout(() => document.getElementById(`${id}-${key}`)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [focusError, id]);
  const fields: MeasurementKey[] = group === 1 && back ? ['backWidth', 'backWaistLength'] : groups[group].fields;
  const viewBox = group === 2 ? '82 125 105 255' : group === 3 ? '125 235 150 395' : '40 15 320 625';
  const leaderSide = active && fields.indexOf(active) % 2 === 1 ? 'right' : 'left';
  const leaderEdge = leaderSide === 'left' ? (group === 2 ? 84 : group === 3 ? 127 : 42) : (group === 2 ? 185 : group === 3 ? 278 : 358);
  const completed = Object.values(values).filter(value => value !== null).length;
  function field(key: MeasurementKey, position?: CSSProperties) {
    const { label, hint } = definitions[key];
    const value = values[key];
    const invalid = value !== null && (!Number.isFinite(value) || value <= 0 || value > 9999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001);
    return <div key={key} style={position} className={`bme-field${active === key ? ' is-active' : ''}`}><div className="bme-field-label"><label htmlFor={`${id}-${key}`}>{label}</label><button type="button" tabIndex={-1} aria-label={`如何测量${label}`} aria-pressed={active === key} onClick={() => setActive(key)}>?</button></div><InputNumber disabled={disabled} readOnly={readOnly} id={`${id}-${key}`} value={values[key]} step={0.01} status={invalid ? 'error' : undefined} aria-invalid={invalid} placeholder="未填写" suffix={key === 'weight' ? 'kg' : 'cm'} controls={false} onFocus={() => setActive(key)} onChange={value => onChange(key, value)} aria-describedby={`${id}-hint-${key}`} /><span id={`${id}-hint-${key}`} className={invalid ? 'bme-error' : 'bme-sr-only'}>{invalid ? '请输入大于 0、不超过 9999.99 且最多两位小数的数值' : hint}</span></div>;
  }
  return <section className="bme" aria-label="身体尺寸编辑器"><header className="bme-toolbar"><div><span className="bme-gender-label">性别 <span aria-hidden="true">*</span></span><Radio.Group disabled={disabled || readOnly} aria-label="性别（必填）" value={genderUnset ? undefined : gender} onChange={event => onGenderChange(event.target.value as BodyGender)} optionType="button" buttonStyle="solid" options={[{ label: '女', value: 'FEMALE' }, { label: '男', value: 'MALE' }]} /><span className="bme-muted">全部选填 · 切换保留输入</span></div><span className="bme-count">已填写 <strong>{completed}</strong> / 27 项</span></header><div className="bme-layout"><nav className="bme-tabs" aria-label="尺寸分组">{groups.map((item, index) => {
    const groupFields: MeasurementKey[] = index === 1 ? [...item.fields, 'backWidth', 'backWaistLength'] : item.fields;
    const filled = groupFields.filter(key => values[key] !== null).length;
    return <button key={item.label} type="button" aria-pressed={group === index} className={group === index ? 'is-selected' : ''} onClick={() => setGroup(index)}><span>{item.label}</span><small>{filled} / {groupFields.length}</small></button>;
  })}<span className="bme-tabs-note">按需填写即可</span></nav><div className="bme-canvas"><div className="bme-view-label"><span>{group === 4 ? '局部测量 · 俯视图' : `${gender === 'FEMALE' ? '女性' : '男性'}轮廓 · ${back ? '背面' : '正面'}`}</span>{group === 1 && <Radio.Group size="small" aria-label="身体视角" value={back} onChange={event => setBack(event.target.value as boolean)} options={[{ label: '正面尺寸', value: false }, { label: '背面尺寸 · 2', value: true }]} optionType="button" />}</div>{group === 4 ? <div className="bme-locals"><div className="bme-local bme-head"><svg viewBox="150 25 100 120" role="img" aria-label="头围示意图"><Outline gender={gender} back={back} /><MeasureLine back={back} gender={gender} active={active === 'head' ? active : null} /></svg><div>{field('head')}<p>软尺经过眉弓上方与后脑最突出点。</p></div></div>{(['left', 'right'] as const).map(side => <div className="bme-local bme-foot" key={side}><span className="bme-local-title">本人{side === 'left' ? '左' : '右'}脚</span><Foot side={side} active={active} /></div>)}{(['leftFootLength', 'rightFootLength', 'leftFootWidth', 'rightFootWidth'] as const).map(key => field(key))}</div> : <div className={`bme-stage${back ? ' bme-stage--back' : ''}`} style={{ gridTemplateRows: `repeat(${Math.ceil(fields.length / 2)}, minmax(0, 1fr))` }}>{fields.map((key, index) => field(key, { gridColumn: index % 2 === 0 ? 1 : 3, gridRow: Math.floor(index / 2) + 1 }))}<svg className="bme-body" style={{ gridRow: `1 / span ${Math.ceil(fields.length / 2)}` }} viewBox={viewBox} role="img" aria-label={`${gender === 'FEMALE' ? '女性' : '男性'}${back ? '背面' : '正面'}人体测量示意图${active ? `，当前${definitions[active].label}` : ''}`}><Outline gender={gender} back={back} /><MeasureLine back={back} gender={gender} active={active} leader={{ side: leaderSide, edge: leaderEdge }} /></svg></div>}<div className="bme-canvas-note">{group === 4 ? '左右以本人为准 · 赤脚平放，双脚分别测量' : '示意图用于定位测量部位，不随填写数值改变体型'}</div></div><aside className="bme-guide" aria-live="polite"><div className="bme-guide-content"><span className="bme-guide-kicker">测量指南</span><h3>{active ? definitions[active].label : '从一项尺寸开始'}</h3><p>{active ? definitions[active].hint : '点击输入框或问号，查看对应的测量位置与方法。所有尺寸均可选填。'}</p>{active && active !== 'weight' && <div className="bme-guide-art">{active.includes('Foot') ? <Foot side={active.startsWith('left') ? 'left' : 'right'} active={active} /> : <svg viewBox={active === 'head' ? '150 25 100 120' : ['height', 'inseam', 'outseam'].includes(active) ? '50 20 300 610' : rings[active] ? `${rings[active]![0]-75} ${rings[active]![1]-55} 150 110` : active === 'armLength' ? '82 125 105 255' : '120 110 165 165'} role="img" aria-label={`${definitions[active].label}测量局部图`}><Outline gender={gender} back={back} /><MeasureLine back={back} gender={gender} active={active} /></svg>}</div>}{active === 'weight' && <div className="bme-scale" aria-hidden="true">kg</div>}<div className="bme-guide-tip"><strong>{active && rings[active] ? '软尺贴合，保持水平' : active === 'weight' ? '保持称量条件一致' : '自然站立，放松身体'}</strong><p>{active && rings[active] ? '实线表示可见段，虚线表示绕至背面的部分。贴合皮肤即可，不要勒紧。' : active === 'weight' ? '穿轻便衣物，使用同一台体重秤，并尽量在同一时段称量。' : '使用软尺；长度沿标示路径读取。肩背等不易触及的位置，可请他人协助。'}</p></div></div></aside></div></section>;
}
