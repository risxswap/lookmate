// 与现有 Web/服务端契约对齐；ID 始终为字符串。
import type { Account } from '../lib/session';
export type { Account } from '../lib/session';

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

export const measurementGroups = [
  { title: '基础与头颈', fields: [['height', '身高', '赤脚站直，从头顶到地面'], ['weight', '体重', '轻装、同一时段称量'], ['head', '头围', '眉弓上方绕头部最宽处'], ['neck', '颈围', '颈根部水平绕一周']] },
  { title: '躯干', fields: [['chest', '胸围', '胸部最丰满处水平一周'], ['underbust', '下胸围', '胸部下缘水平一周'], ['waist', '腰围', '自然腰线最细处一周'], ['abdomen', '腹围', '腹部最突出部位水平一周'], ['hip', '臀围', '臀部最丰满处水平一周'], ['shoulder', '肩宽', '左右肩端点之间'], ['backWidth', '背宽', '后背两侧腋点之间'], ['frontWaistLength', '前腰节长', '肩颈点经胸前至腰线'], ['backWaistLength', '后腰节长', '后颈点沿背部至腰线']] },
  { title: '手臂', fields: [['armLength', '臂长', '肩端点经微屈肘至腕部'], ['upperArm', '上臂围', '上臂最粗处一周'], ['forearm', '前臂围', '前臂最粗处一周'], ['wrist', '腕围', '手腕最细处一周']] },
  { title: '腿部', fields: [['inseam', '内腿长', '裆底沿内腿至地面'], ['outseam', '外腿长', '腰线沿外腿至地面'], ['thigh', '大腿围', '大腿最粗处一周'], ['knee', '膝围', '膝关节中部一周'], ['calf', '小腿围', '小腿最粗处一周'], ['ankle', '踝围', '脚踝最细处一周']] },
  { title: '脚部', fields: [['leftFootLength', '左脚长', '脚跟至最长脚趾'], ['rightFootLength', '右脚长', '脚跟至最长脚趾'], ['leftFootWidth', '左脚宽', '前脚掌最宽处'], ['rightFootWidth', '右脚宽', '前脚掌最宽处']] },
] as const;
export type MeasurementKey = typeof measurementGroups[number]['fields'][number][0];
export type MeasurementValues = Record<MeasurementKey, number | null>;
export type Measurement = MeasurementValues & { id: string; createdAt: string; updatedAt: string; current: boolean };
export interface Profile extends Pick<Account, 'id' | 'username' | 'displayName'> { gender: 'FEMALE' | 'MALE' | null; birthDate: string | null; preferences: Preferences | null; version: string; currentMeasurementId: string | null; currentMeasurement: Measurement | null; defaultPortraitId: string | null; defaultFullBodyId: string | null }
export const photoTypes = [{ value: 'PORTRAIT', label: '头像' }, { value: 'FULL_BODY', label: '全身照' }, { value: 'REFERENCE', label: '参考图' }];
export const photoAngles = [{ value: 'SIDE_FACE', label: '侧脸' }, { value: 'BACK_HEAD', label: '后脑' }, { value: 'SIDE_BODY', label: '侧面全身' }, { value: 'BACK_BODY', label: '背面全身' }] as const;
export type PhotoAngle = typeof photoAngles[number]['value'];
export interface Photo { angle: PhotoAngle | null; id: string; fileId: string; photoType: string; createdAt: string; updatedAt: string }
export const emptyMeasurements = (): MeasurementValues => Object.fromEntries(measurementGroups.flatMap(group => group.fields.map(([key]) => [key, null]))) as MeasurementValues;
export const measurementValues = (value: Measurement | null): MeasurementValues => Object.fromEntries(measurementGroups.flatMap(group => group.fields.map(([key]) => [key, value?.[key] ?? null]))) as MeasurementValues;


export type DesignType = 'OVERALL' | 'HAIRSTYLE' | 'OUTFIT';
export interface DesignInput {
  designType: DesignType; personFileId: string; profileVersion: string;
  requirements: string; occasion: string; style: string; weatherNote: string;
  requiredDressIds: string[]; useMeasurements: boolean; measurementId: string | null;
  constraintOverrides: string[];
  outfitInspirationId?: string | null; outfitInspirationVersion?: string | null;
  hairstyleId?: string | null; hairstyleVersion?: string | null; useReferenceHairColor?: boolean;
}
export interface HairstyleReference {
  id: string; version: string; name: string;
  length: 'SHORT' | 'MEDIUM' | 'LONG'; bangs: 'NONE' | 'LIGHT' | 'FULL'; texture: 'STRAIGHT' | 'WAVY' | 'CURLY';
  description: string; careAdvice: string;
  images: { id: string; angle: 'FRONT' | 'SIDE' | 'BACK'; url: string }[];
}
export interface OutfitInspirationReference {
  id: string; version: string; name: string;
  primaryOccasion: string; occasions: string[]; styles: string[];
  image: { id: string; url: string; width: number; height: number } | null;
  styling: { palette: string; silhouette: string; wearing: string };
}
export interface PersonalContext {
  profileVersion: string; gender: string | null; age: number | null; ageAsOf: string;
  preferences: Preferences | null; measurementState: string; measurementId: string | null;
  measurements: Partial<MeasurementValues> | null; measurementUnits?: { length: string; weight: string };
}
export interface RequiredDress { dressId: string; dressName: string; categoryName: string; imageFileIds: string[] }
export interface DesignNotice { code: string; severity: string; message: string; placement?: string }
export interface Preview {
  hairstyleReference?: HairstyleReference | null;
  outfitInspirationReference?: OutfitInspirationReference | null;
  canSubmit: boolean; previewToken: string | null; expiresAt: string | null; inputDigest: string;
  personPhoto: { fileId: string }; requiredDresses: RequiredDress[]; personalContext: PersonalContext;
  restrictions: { id: string; text: string; overridden: boolean }[];
  conflicts: { restrictionId: string; requirementExcerpt: string; message: string }[];
  notices: DesignNotice[]; limits: { maxRequiredDressCount: number }; semanticCheck: string;
}
export interface InputSummary {
  hairstyleReference?: HairstyleReference | null;
  outfitInspirationReference?: OutfitInspirationReference | null;
  schemaVersion: number; request: Partial<DesignInput>; personPhoto: { fileId: string };
  personalContext: PersonalContext; requiredDresses: RequiredDress[];
  constraintOverrides: { id: string; originalText: string }[];
}
export interface Submission { taskId: string; status: string; statusUrl: string; retryOfTaskId?: string }
export type PendingSubmission = { accountId: string; key: string } & (
  { kind: 'CREATE'; input: DesignInput; previewToken: string } |
  { kind: 'RETRY'; sourceId: string; mode: 'FULL' | 'IMAGE_ONLY' }
);

export interface Category { id: string; code: string; name: string; sortOrder: number }
export const seasons = [{ value: 'SPRING', label: '春季' }, { value: 'SUMMER', label: '夏季' }, { value: 'AUTUMN', label: '秋季' }, { value: 'WINTER', label: '冬季' }];
export const featureLabels = { viewType: '拍摄视角', description: '单品描述', colors: '颜色', pattern: '图案', styleTags: '风格标签', fit: '版型', materialDescription: '材质说明', details: '细节' };
export type FeatureKey = keyof typeof featureLabels;
export type Features = Partial<Record<FeatureKey, string | string[] | Record<string, string | null> | null>>;
export interface DressImage { id: string; fileId: string; sortOrder: number; version: string; aiFeatures: Features | null; manualFeatures: Features | null; effectiveFeatures: Features | null; recognitionId: string | null; aiCurrent: boolean }
export interface Recognition { id: string; status: string; errorCode: string | null; errorMessage: string | null; createdAt: string; updatedAt: string }
export interface Dress { id: string; name: string; categoryId: string; color: string | null; seasons: string[]; notes: string | null; imageRevision: string; createdAt: string; updatedAt: string; images: DressImage[]; recognition: Recognition | null }
export interface FileAsset { id: string; status: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null; validationError: string | null }
export const recognizing = (r?: Recognition | null) => !!r && ['PENDING', 'RUNNING'].includes(r.status);
export const recognitionLabels: Record<string, string> = { PENDING: '等待识别', RUNNING: '正在识别', SUCCEEDED: '识别完成', FAILED: '识别失败', UNKNOWN: '识别结果待确认' };


export type TaskStatus = 'QUEUED' | 'PLANNING' | 'GENERATING' | 'SAVING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export interface TaskSummary {
  outfitId?: string | null;
  jobKind?: 'EVALUATION' | 'IMAGE' | null;
  id: string;
  designType: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  title: string | null;
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  actions: string[];
  resultId: string | null;
  favoriteId: string | null;
}
export interface DesignResult {
  inspirationAdaptation: { borrowedElements: string[]; differences: string[] } | null;
  id: string;
  title: string;
  summary: string;
  style: string;
  occasion: string;
  designReason: string;
  colorAdvice: string | null;
  wearingAdvice: string | null;
  hairstyle: null | {
    hairstyleName: string; lengthAdvice: string; bangsAdvice: string;
    partingAdvice: string; textureAdvice: string; hairColorAdvice: string; careAdvice: string;
  };
  matchLevel?: string | null;
  notices?: DesignNotice[];
  illustrativeShoes?: { description: string; source: string } | null;
  novelty?: { description?: string; explanation?: string } | null;
  items: { imageFileIds?: string[]; role?: string; dressId: string; dressName: string; categoryName: string; matchReason: string; wearingMethod: string }[];
}
export interface DesignDetail extends TaskSummary {
  result: DesignResult | null;
  inputSummary?: InputSummary | null;
  outputFileId?: string | null;
  failure?: { stage: string; category: string; code: string; message: string; suggestedAction: string } | null;
}
export interface WorkspaceData { activeTask: TaskSummary | null; recentTasks: TaskSummary[] }
export const isActive = (status?: TaskStatus) => status !== undefined && ['QUEUED', 'PLANNING', 'GENERATING', 'SAVING'].includes(status);

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export interface Collection { id: string; name: string; version: string; createdAt: string; updatedAt: string }
export interface Favorite { id: string; resultId: string; createdAt: string; collectionIds: string[]; task: TaskSummary }

export interface OutfitGroup { id: string; name: string; version: string }
export interface OutfitItem { dressId: string; dressName: string; categoryId: string; categoryName: string; categoryCode: string; color: string | null; imageFileIds: string[]; missing: boolean }
export interface Outfit { scenes?: string[]; id: string; name: string; note: string | null; pinned: boolean; version: string; revision: string; groups: OutfitGroup[]; items: OutfitItem[]; sourceOutputFileId: string | null; sourceDesignId: string | null }
export interface OutfitJob { taskId: string; outfitId: string; revision: string; kind: 'EVALUATION' | 'IMAGE'; status: TaskStatus; stale: boolean; createdAt: string; errorMessage: string | null; actions: string[]; outputFileId: string | null; result: DesignResult | null }


export interface OutfitPlan {
  id: string; version: string; date: string; scene: string; note: string | null;
  sourceOutfitId: string | null; sourceMissing: boolean; outfit: Outfit | null;
  createdAt: string; updatedAt: string;
}
export interface CreatePlan { clientRequestId: string; date: string; scene: string; note: string | null; outfitId: string | null }
export const presetScenes = ['通勤', '日常', '约会', '运动', '聚会', '旅行'];


export interface Hairstyle extends HairstyleReference {
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  favorited: boolean;
  favoritedAt: string | null;
}


export interface OutfitInspiration extends OutfitInspirationReference {
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  favorited: boolean;
  favoritedAt: string | null;
}
