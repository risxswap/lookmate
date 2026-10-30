import { useState } from 'react';
import { Descriptions, Typography } from 'antd';
import type { OutfitInspirationReference } from '../generation/api';
export const outfitLabels: Record<string, Record<string, string>> = {
  occasion: { DAILY: '日常', COMMUTE: '通勤', DATE: '约会', PARTY: '聚会', TRAVEL: '出游' },
  style: { MINIMAL: '简约', CASUAL: '休闲', COMMUTE: '通勤', RETRO: '复古', SPORT_CASUAL: '运动休闲', SOFT: '温柔' },
};
export function OutfitImage({ value }: { value: OutfitInspirationReference }) {
  const [failed, setFailed] = useState(false);
  return <div className="outfit-reference-image">{value.image && !failed ? <img src={value.image.url} alt={`${value.name}穿搭灵感示意图`} loading="lazy" onError={() => setFailed(true)} /> : <span>参考图片暂不可用</span>}</div>;
}
export function OutfitReferenceCard({ value }: { value: OutfitInspirationReference }) {
  return <section className="outfit-reference-card"><OutfitImage key={`${value.id}:${value.version}`} value={value} /><div><Typography.Title level={4}>{value.name}</Typography.Title><Typography.Paragraph type="secondary">{value.occasions.map(v => outfitLabels.occasion[v] || v).join(' · ')} / {value.styles.map(v => outfitLabels.style[v] || v).join(' · ')}</Typography.Paragraph><Descriptions column={1} size="small" items={[{ key: 'palette', label: '配色', children: value.styling.palette }, { key: 'silhouette', label: '轮廓', children: value.styling.silhouette }, { key: 'wearing', label: '穿法', children: value.styling.wearing }]} /><Typography.Paragraph type="secondary">AI 穿搭示意。借鉴搭配思路，用你的衣物重新搭配；不添加图中的服装，不改变你的发型。</Typography.Paragraph></div></section>;
}
