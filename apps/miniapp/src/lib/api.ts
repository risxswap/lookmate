import { request } from './request';
import { query } from './ui';
import type { Account, Page, Profile, Photo, Measurement, Category, Dress, Hairstyle, OutfitInspiration, WorkspaceData, DesignDetail, TaskSummary, DesignInput, Preview, Submission, PendingSubmission, Collection, Favorite, Outfit, OutfitGroup, OutfitJob, OutfitPlan } from '../types/api';
const id=(value:string)=>encodeURIComponent(value);
export function list<T>(path:string,page=1,pageSize=20,filters:Record<string,unknown>={}):Promise<Page<T>> {return request(`${path}?${query({...filters,page,pageSize})}`);}
export const api={
  profile:()=>request<Profile>('/profile'),
  workspace:()=>request<WorkspaceData>('/workspace'),
  categories:()=>request<Category[]>('/dresses/categories'),
  dresses:(page=1,pageSize=20,categoryId='')=>list<Dress>('/dresses',page,pageSize,{categoryId}),
  dress:(dressId:string)=>request<Dress>(`/dresses/${id(dressId)}`),
  photos:(page=1,pageSize=20)=>list<Photo>('/photos',page,pageSize),
  measurements:(page=1,pageSize=20)=>list<Measurement>('/profile/measurements',page,pageSize),
  hairstyles:(page=1,pageSize=20,filters:Record<string,unknown>={})=>list<Hairstyle>('/hairstyles',page,pageSize,filters),
  inspirations:(page=1,pageSize=20,filters:Record<string,unknown>={})=>list<OutfitInspiration>('/outfit-inspirations',page,pageSize,filters),
  design:(taskId:string)=>request<DesignDetail>(`/designs/${id(taskId)}`),
  designs:(page=1,pageSize=20,filters:Record<string,unknown>={})=>list<TaskSummary>('/designs',page,pageSize,filters),
  preview:(input:DesignInput)=>request<Preview>('/designs/preview',{method:'POST',body:input}),
  byRequest:(key:string)=>request<Submission>(`/designs/by-request/${id(key)}`),
  submit:(pending:PendingSubmission)=>request<Submission>(pending.kind==='CREATE'?'/designs':`/designs/${id(pending.sourceId)}/retry`,{method:'POST',headers:{'Idempotency-Key':pending.key},body:pending.kind==='CREATE'?{input:pending.input,previewToken:pending.previewToken}:{mode:pending.mode}}),
  collections:(page=1,pageSize=20)=>list<Collection>('/collections',page,pageSize),
  favorites:(page=1,pageSize=20,collectionId='')=>list<Favorite>('/favorites',page,pageSize,{collectionId}),
  outfits:(page=1,pageSize=20,filters:Record<string,unknown>={})=>list<Outfit>('/outfits',page,pageSize,filters),
  outfit:(outfitId:string)=>request<Outfit>(`/outfits/${id(outfitId)}`),
  outfitGroups:(page=1,pageSize=20)=>list<OutfitGroup>('/outfit-groups',page,pageSize),
  outfitJobs:(outfitId:string,page=1,pageSize=20)=>list<OutfitJob>(`/outfits/${id(outfitId)}/ai-jobs`,page,pageSize),
  plans:(date:string,page=1,pageSize=20)=>list<OutfitPlan>('/outfit-plans',page,pageSize,{date}),
  avatar:(fileId:string|null)=>request<Account>('/profile/avatar',{method:'PUT',body:{fileId}}),
};
