import { useQuery } from '@tanstack/react-query';
import { request, type Account } from '../../api/client';
import type { Page } from '../designs/queries';
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
export interface Profile extends Pick<Account, 'id' | 'username' | 'displayName'> { gender: 'FEMALE' | 'MALE' | null; birthDate: string | null; preferences: import('./preferences').Preferences | null; version: string; currentMeasurementId: string | null; currentMeasurement: Measurement | null; defaultPortraitId: string | null; defaultFullBodyId: string | null }
export const photoTypes = [{ value: 'PORTRAIT', label: '头像' }, { value: 'FULL_BODY', label: '全身照' }, { value: 'REFERENCE', label: '参考图' }];
export const photoAngles = [{ value: 'SIDE_FACE', label: '侧脸' }, { value: 'BACK_HEAD', label: '后脑' }, { value: 'SIDE_BODY', label: '侧面全身' }, { value: 'BACK_BODY', label: '背面全身' }] as const;
export type PhotoAngle = typeof photoAngles[number]['value'];
export interface Photo { angle: PhotoAngle | null; id: string; fileId: string; photoType: string; createdAt: string; updatedAt: string }
export const emptyMeasurements = (): MeasurementValues => Object.fromEntries(measurementGroups.flatMap(group => group.fields.map(([key]) => [key, null]))) as MeasurementValues;
export const measurementValues = (value: Measurement | null): MeasurementValues => Object.fromEntries(measurementGroups.flatMap(group => group.fields.map(([key]) => [key, value?.[key] ?? null]))) as MeasurementValues;
export function useProfile(accountId: string, enabled = true) {
  return useQuery({ queryKey: ['profile', accountId], enabled, queryFn: ({ signal }) => request<Profile>('/profile', { signal }), refetchOnWindowFocus: false });
}
export function useMeasurements(accountId: string, page: number) {
  return useQuery({ queryKey: ['measurements', accountId, page], queryFn: ({ signal }) => request<Page<Measurement>>(`/profile/measurements?page=${page}&pageSize=10`, { signal }) });
}
export function usePhotos(accountId: string, page: number, type: string) {
  return useQuery({ queryKey: ['photos', accountId, page, type], queryFn: ({ signal }) => request<Page<Photo>>(`/photos?page=${page}&pageSize=12${type ? `&photoType=${type}` : ''}`, { signal }) });
}
