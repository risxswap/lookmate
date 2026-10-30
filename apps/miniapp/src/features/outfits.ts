import { getAccount } from '../lib/auth';
import { request } from '../lib/request';
import { fileUrls } from '../lib/files';
import type { Outfit, OutfitJob, CreatePlan } from '../types/api';
export type PendingJob = {key:string;outfitId:string;body:{kind:'EVALUATION'|'IMAGE';revision:string;personFileId?:string}} | {key:string;outfitId:string;sourceId:string;body:{mode:'FULL'|'IMAGE_ONLY'}};
export const submitJob=(pending:PendingJob)=>request<OutfitJob>('sourceId' in pending?`/outfit-ai-jobs/${pending.sourceId}/retry`:`/outfits/${pending.outfitId}/ai-jobs`,{method:'POST',headers:{'Idempotency-Key':pending.key},body:pending.body});
export const recoverJob=(key:string)=>request<OutfitJob>(`/outfit-ai-jobs/by-request/${encodeURIComponent(key)}`);
export const currentJobs=(outfitId:string)=>request<{evaluation:OutfitJob|null;image:OutfitJob|null;latest:OutfitJob|null}>(`/outfits/${outfitId}/ai-jobs/current`);
export async function outfitCards(items:Outfit[]) { const urls=await fileUrls(items.map(o=>o.sourceOutputFileId || o.items[0]?.imageFileIds[0] || '').filter(Boolean)); return items.map(o=>({...o,cover:urls[o.sourceOutputFileId || o.items[0]?.imageFileIds[0] || '']||'',scenesText:(o.scenes||[]).join(' · '),itemsText:o.items.map(i=>i.dressName).join('、')})); }
export function uuidKey(hex:string):string { return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`; }
export function monthRange(date:string) { const [y,m]=date.split('-').map(Number); return {from:`${y}-${String(m).padStart(2,'0')}-01`,to:`${y}-${String(m).padStart(2,'0')}-${new Date(y,m,0).getDate()}`}; }
export const createPlan=(body:CreatePlan)=>request('/outfit-plans',{method:'POST',body});

export function assertAccount(account:string):void { if(!account || getAccount()?.id!==account)throw new Error('账号已变化，请重新打开页面后操作'); }

export function outfitIsDirty(outfit:Outfit, form:{name:string;note:string;dressIds:string[];groupIds:string[];pinned:boolean;scenes:string}):boolean {
 const same=(a:string[],b:string[])=>JSON.stringify(a)===JSON.stringify(b);
 const scenes=[...new Set(form.scenes.split(/[、,，\n]/).map(s=>s.trim()).filter(Boolean))].sort();
 return form.name.trim()!==outfit.name || (form.note.trim()||null)!==outfit.note || form.pinned!==outfit.pinned || !same(form.dressIds,outfit.items.map(i=>i.dressId)) || !same([...form.groupIds].sort(),outfit.groups.map(g=>g.id).sort()) || !same(scenes,[...(outfit.scenes||[])].sort());
}
