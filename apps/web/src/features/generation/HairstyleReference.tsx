import { useState } from 'react';
import { Button, Image, Typography } from 'antd';
import type { HairstyleReference as Reference } from './api';

export const hairLabels = {
  length: { SHORT: '短发', MEDIUM: '中长发', LONG: '长发' },
  bangs: { NONE: '无刘海', LIGHT: '轻薄刘海', FULL: '齐刘海' },
  texture: { STRAIGHT: '直发', WAVY: '微卷', CURLY: '卷发' },
  angle: { FRONT: '正面', SIDE: '侧面', BACK: '背面' },
};

export function HairImages({ value, large = false }: { value: Reference; large?: boolean }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = value.images.find(image => image.id === chosen) || value.images[0];
  if (!selected) return <Typography.Text type="secondary">暂无参考图片</Typography.Text>;
  return <div className={`hair-reference-images${large ? ' is-large' : ''}`}>
    <Image src={selected.url} alt={`${value.name}·${hairLabels.angle[selected.angle] || '参考图'}`} />
    {value.images.length > 1 ? <div className="hair-angle-list" aria-label="参考图角度">{value.images.map(image => <Button key={image.id} className={image.id === selected.id ? 'is-selected' : ''} aria-pressed={image.id === selected.id} aria-label={`查看${hairLabels.angle[image.angle] || '参考图'}`} onClick={() => setChosen(image.id)}><img src={image.url} alt="" /><span>{hairLabels.angle[image.angle] || '参考图'}</span></Button>)}</div> : null}
  </div>;
}

export function HairstyleReferenceCard({ value }: { value: Reference }) {
  return <div className="hair-reference-card">
    <HairImages key={`${value.id}-${value.version}`} value={value} />
    <div><Typography.Text strong>{value.name}</Typography.Text><Typography.Paragraph type="secondary">{[hairLabels.length[value.length], hairLabels.bangs[value.bangs], hairLabels.texture[value.texture]].filter(Boolean).join(' · ')}</Typography.Paragraph><Typography.Text type="secondary">AI 发型示意 · {value.images.length} 张参考图</Typography.Text></div>
  </div>;
}
