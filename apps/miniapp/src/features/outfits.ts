import { getAccount } from '../lib/auth';
import { request } from '../lib/request';
import type { Outfit, OutfitJob, CreatePlan } from '../types/api';
export type PendingJob = {key:string;outfitId:string;body:{kind:'EVALUATION'|'IMAGE';revision:string;personFileId?:string}} | {key:string;outfitId:string;sourceId:string;body:{mode:'FULL'|'IMAGE_ONLY'}};
export const submitJob=(pending:PendingJob)=>request<OutfitJob>('sourceId' in pending?`/outfit-ai-jobs/${pending.sourceId}/retry`:`/outfits/${pending.outfitId}/ai-jobs`,{method:'POST',headers:{'Idempotency-Key':pending.key},body:pending.body});
export const recoverJob=(key:string)=>request<OutfitJob>(`/outfit-ai-jobs/by-request/${encodeURIComponent(key)}`);
export const currentJobs=(outfitId:string)=>request<{evaluation:OutfitJob|null;image:OutfitJob|null;latest:OutfitJob|null}>(`/outfits/${outfitId}/ai-jobs/current`);
export function outfitCoverId(outfit: Outfit) {
  return outfit.sourceOutputFileId || outfit.items[0]?.imageFileIds[0] || '';
}
export function outfitCoverEntries(items: (Outfit & { cover: string })[]): [string, string][] {
  return items.map(item => [outfitCoverId(item), item.cover]);
}
export function withOutfitCovers(items: Outfit[], urls: Record<string, string>) {
  return items.map(item => ({
    ...item, cover: urls[outfitCoverId(item)] || '', scenesText: (item.scenes || []).join(' · '),
    itemsText: item.items.map(dress => dress.dressName).join('、')
  }));
}
export async function outfitCards(items: Outfit[], resolveCovers: (ids: string[]) => Promise<Record<string,string>>) {
  return withOutfitCovers(items, await resolveCovers(items.map(outfitCoverId)));
}
export function uuidKey(hex:string):string { return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`; }
export function monthRange(date:string) { const [y,m]=date.split('-').map(Number); return {from:`${y}-${String(m).padStart(2,'0')}-01`,to:`${y}-${String(m).padStart(2,'0')}-${new Date(y,m,0).getDate()}`}; }
export const createPlan=(body:CreatePlan)=>request('/outfit-plans',{method:'POST',body});

export function assertAccount(account:string):void { if(!account || getAccount()?.id!==account)throw new Error('账号已变化，请重新打开页面后操作'); }

type OutfitForm = { name: string; note: string; dressIds: string[]; groupIds: string[]; pinned: boolean; scenes: string };
export function sceneNames(value: string): string[] {
  return [...new Set(value.split(/[、,，\n]/).map(scene => scene.trim()).filter(Boolean))];
}
export function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(id => right.includes(id));
}
function outfitChanges(form: OutfitForm, previous: Outfit | null) {
  const name = form.name.trim();
  const note = form.note.trim() || null;
  return {
    ...(!previous || name !== previous.name ? { name } : {}),
    ...(!previous || note !== previous.note ? { note } : {}),
    ...(!previous || form.pinned !== previous.pinned ? { pinned: form.pinned } : {}),
    ...(!previous || form.dressIds.length !== previous.items.length ||
      form.dressIds.some((id, index) => id !== previous.items[index].dressId) ? { dressIds: form.dressIds } : {}),
    ...(!previous || !sameMembers(form.groupIds, previous.groups.map(group => group.id)) ? { groupIds: form.groupIds } : {})
  };
}
export function saveOutfit(form: OutfitForm, previous: Outfit | null): Promise<Outfit> {
  const changes = outfitChanges(form, previous);
  if (!previous) return request<Outfit>('/outfits', { method: 'POST', body: changes });
  if (!Object.keys(changes).length) return Promise.resolve(previous);
  return request<Outfit>(`/outfits/${previous.id}`, { method: 'PATCH', body: { ...changes, version: previous.version } });
}
export function outfitIsDirty(outfit: Outfit, form: OutfitForm): boolean {
  return Object.keys(outfitChanges(form, outfit)).length > 0 || !sameMembers(sceneNames(form.scenes), outfit.scenes || []);
}
