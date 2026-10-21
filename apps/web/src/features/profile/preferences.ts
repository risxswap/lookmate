export type PreferenceTag = { type: 'PRESET'; code: string } | { type: 'CUSTOM'; text: string };
export const dictionaries = {
 interests: { HIKING:'徒步', CAMPING:'露营', CYCLING:'骑行', RUNNING:'跑步', FITNESS:'健身', TRAVEL:'旅行', PHOTOGRAPHY:'摄影', MUSIC:'音乐', READING:'阅读', ART:'艺术' },
 styles: { MINIMAL:'简约', CASUAL:'休闲', BUSINESS:'通勤', SPORTY:'运动', OUTDOOR:'户外', RETRO:'复古', STREET:'街头', ELEGANT:'优雅', SWEET:'甜美', ANDROGYNOUS:'中性' },
 colors: { BLACK:'黑', WHITE:'白', GRAY:'灰', BEIGE:'米色', BROWN:'棕', RED:'红', ORANGE:'橙', YELLOW:'黄', GREEN:'绿', BLUE:'蓝', PURPLE:'紫', PINK:'粉' },
 fits: { LOOSE:'宽松', REGULAR:'合身', SLIM:'修身' }, hairLengths: { SHORT:'短发', MEDIUM:'中长发', LONG:'长发' },
 restrictions: { NO_HIGH_HEELS:'不穿高跟鞋', NO_MIDRIFF:'不穿露腰款', NO_TIGHT:'不穿紧身款', NO_SHORTENING:'不接受剪短' },
};
export interface Preferences {
 interests: PreferenceTag[]; styles: PreferenceTag[]; preferredColors: PreferenceTag[]; avoidedColors: PreferenceTag[];
 fits: string[]; hairLengths: string[]; restrictions: string[];
 dyeAcceptance: 'ACCEPT' | 'REJECT' | null; permAcceptance: 'ACCEPT' | 'REJECT' | null; groomingEffort: 'LOW' | 'MEDIUM' | 'HIGH' | null;
 outfitNote: string | null; hairNote: string | null; restrictionNote: string | null;
}
export const emptyPreferences = (): Preferences => ({ interests: [], styles: [], preferredColors: [], avoidedColors: [], fits: [], hairLengths: [], restrictions: [], dyeAcceptance:null, permAcceptance:null, groomingEffort:null, outfitNote:null, hairNote:null, restrictionNote:null });
export const count = (value: string) => Array.from(value).length;
export const trimPreferenceText = (value: string) => value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '');
export const normalizedText = (value: string) => trimPreferenceText(value).normalize('NFC');
export const tagKey = (value: PreferenceTag) => value.type === 'PRESET' ? `preset:${value.code}` : `custom:${normalizedText(value.text)}`;
export function normalizeTags(items: PreferenceTag[], dictionary: Record<string,string>): PreferenceTag[] {
 const result: PreferenceTag[] = []; const seen = new Set<string>();
 for (const item of items) { const text = item.type === 'CUSTOM' ? normalizedText(item.text) : ''; const preset = Object.keys(dictionary).find(key => dictionary[key] === text); const next: PreferenceTag = item.type === 'PRESET' ? item : preset ? {type:'PRESET',code:preset} : {type:'CUSTOM',text}; if (!seen.has(tagKey(next))) { result.push(next); seen.add(tagKey(next)); } } return result;
}
export function cleanPreferences(value: Preferences): Preferences { return { ...value, interests:normalizeTags(value.interests,dictionaries.interests), styles:normalizeTags(value.styles,dictionaries.styles), preferredColors:normalizeTags(value.preferredColors,dictionaries.colors), avoidedColors:normalizeTags(value.avoidedColors,dictionaries.colors), outfitNote:trimPreferenceText(value.outfitNote || '') || null, hairNote:trimPreferenceText(value.hairNote || '') || null, restrictionNote:trimPreferenceText(value.restrictionNote || '') || null }; }
export function preferenceErrors(value: Preferences): string[] {
 const p = cleanPreferences(value); const errors: string[] = [];
 if (p.preferredColors.some(v => p.avoidedColors.some(other => tagKey(v) === tagKey(other)))) errors.push('同一种颜色不能同时设为喜欢和不喜欢，请调整选择。');
 if (p.fits.includes('SLIM') && p.restrictions.includes('NO_TIGHT')) errors.push('“修身”与“不穿紧身款”存在冲突，请调整其中一项。');
 if (Object.values(p).some(v => Array.isArray(v) && v.length > 20)) errors.push('每个多选字段最多 20 项。');
 if ([p.outfitNote,p.hairNote,p.restrictionNote].some(v => count(v || '') > 500)) errors.push('补充说明最多 500 个字符。');
 return errors;
}
