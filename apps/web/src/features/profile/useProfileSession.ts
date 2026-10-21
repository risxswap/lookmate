import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, request, type Account } from '../../api/client';
import { accountKey } from '../auth/queries';
import { measurementValues, type Profile } from './queries';
import { emptyPreferences, type Preferences } from './preferences';
export type SaveScope = 'basic' | 'measurements' | 'preferences' | 'current' | 'photos';
export interface ProfileWrite { path: string; method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: Record<string, unknown>; scope?: SaveScope }
interface FrozenWrite extends ProfileWrite { body: Record<string, unknown>; scope: SaveScope }
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function useProfileSession(initial: Profile) {
 const client = useQueryClient();
 const [baseline, setBaseline] = useState(initial);
 const baseRef = useRef(baseline); baseRef.current = baseline;
 const [name, setName] = useState(initial.displayName ?? '');
 const [birthDate, setBirthDate] = useState(initial.birthDate ?? '');
 const [gender, setGender] = useState<Profile['gender']>(initial.gender ?? 'FEMALE');
 const [values, setValues] = useState(() => measurementValues(initial.currentMeasurement));
 const [preferences, setPreferences] = useState<Preferences>(() => initial.preferences ?? emptyPreferences());
 const [tagDrafts, setTagDrafts] = useState<Record<string,string>>({});
 const [busy, setBusy] = useState(false);
 const lock = useRef(false);
 const [notice, setNotice] = useState('');
 const [error, setError] = useState('');
 const [comparison, setComparison] = useState<Profile | null>(null);
 const [conflict, setConflict] = useState(false);
 const [unknown, setUnknown] = useState<FrozenWrite | null>(null);
 const [confirmed, setConfirmed] = useState<FrozenWrite | null>(null);
 const basicDirty = name !== (baseline.displayName ?? '') || birthDate !== (baseline.birthDate ?? '') || gender !== baseline.gender;
 const sizesDirty = !equal(values, measurementValues(baseline.currentMeasurement));
 const preferencesDirty = !equal(preferences, baseline.preferences ?? emptyPreferences()) || Object.values(tagDrafts).some(Boolean);
 const dirty = basicDirty || sizesDirty || preferencesDirty;
 function cache(next: Profile) { setBaseline(next); baseRef.current = next; client.setQueryData(['profile', next.id], next); client.setQueryData<Account | null>(accountKey, old => old?.id === next.id ? {id: next.id, username: next.username, displayName: next.displayName} : old); }
 function applySaved(next: Profile, input: FrozenWrite) {
   const old = baseRef.current;
   // Advance untouched values only. Drafts in other tabs remain attached to the same session.
   setName(v => input.scope === 'basic' || v === (old.displayName ?? '') ? next.displayName ?? '' : v);
   setBirthDate(v => input.scope === 'basic' || v === (old.birthDate ?? '') ? next.birthDate ?? '' : v);
   setGender(v => ['basic','measurements'].includes(input.scope) || v === old.gender ? next.gender ?? 'FEMALE' : v);
   setValues(v => ['measurements','current'].includes(input.scope) || equal(v, measurementValues(old.currentMeasurement)) ? measurementValues(next.currentMeasurement) : v);
   setPreferences(v => input.scope === 'preferences' || equal(v, old.preferences ?? emptyPreferences()) ? next.preferences ?? emptyPreferences() : v);
   if (input.scope === 'preferences') setTagDrafts({});
   cache(next);
   // A confirmed response supersedes any comparison fetched before retrying.
   setComparison(null);
 }
 async function refreshLists() {
   try { await Promise.all(['measurements','photos'].map(key => client.invalidateQueries({queryKey:[key, initial.id]}, {throwOnError:true}))); }
   catch { setNotice('已保存，列表刷新失败。请在历史或照片列表重试查询，不需要再次保存。'); }
 }
 async function run(input: FrozenWrite, onSuccess?: () => void) {
   if (lock.current) return;
   lock.current = true; setBusy(true); setError(''); setNotice('');
   let wrote = false;
   try {
     const result = await request<Profile | { profile: Profile } | null>(input.path, {method:input.method, body:input.body});
     wrote = true; setUnknown(null); setConflict(false);
     let next = result && 'profile' in result ? result.profile : result && 'version' in result ? result : null;
     if (!next) {
       setConfirmed(input); setNotice('操作已保存，正在读取最新资料。');
       next = await request<Profile>('/profile');
     }
     if (next.version !== (BigInt(input.body.version as string) + 1n).toString()) { setComparison(next); setNotice('操作已保存，但资料随后发生了其他修改。请比较后选择。'); setConfirmed(null); onSuccess?.(); return; }
     applySaved(next, input); setConfirmed(null); setNotice('已保存'); onSuccess?.(); await refreshLists();
   } catch (e) {
     if (wrote) { setNotice('操作已保存，但最新资料读取失败。请重试读取，勿再次提交。'); }
     else if (e instanceof ApiError && e.status < 500) {
       setError(e.message); setUnknown(null);
       if (e.detail.code === 'VERSION_CONFLICT') setConflict(true);
     } else { setUnknown(input); setError('保存结果尚未确认。原请求与版本已保留，请刷新核对；重试只会发送原请求。'); }
   } finally { lock.current = false; setBusy(false); }
 }
 function save(input: ProfileWrite, onSuccess?: () => void) {
   if (lock.current || comparison || conflict || unknown || confirmed) return;
   const frozen: FrozenWrite = { ...input, scope: input.scope ?? 'photos', body:{...input.body,version:baseRef.current.version} };
   void run(frozen, onSuccess);
 }
 async function refresh() {
   if (lock.current) return; lock.current = true; setBusy(true); setError('');
   try {
     const next = await request<Profile>('/profile');
     if (confirmed) { if (next.version === (BigInt(confirmed.body.version as string) + 1n).toString()) { applySaved(next,confirmed); setNotice('已保存，最新资料已读取'); } else { setComparison(next); setNotice('操作已保存，但服务端资料又发生了变化，请比较后选择。'); } setConfirmed(null); await refreshLists(); }
     else if (!equal(next,baseRef.current) || unknown || conflict) setComparison(next);
     else setNotice('服务端资料未变化。');
   } catch (e) { setError(e instanceof Error ? e.message : '读取失败，请重试。'); }
   finally { lock.current=false; setBusy(false); }
 }
 function resolve(keep: boolean) {
   if (lock.current || !comparison || BigInt(comparison.version) < BigInt(baseRef.current.version)) return;
   if (!keep) { setName(comparison.displayName ?? ''); setBirthDate(comparison.birthDate ?? ''); setGender(comparison.gender ?? 'FEMALE'); setValues(measurementValues(comparison.currentMeasurement)); setPreferences(comparison.preferences ?? emptyPreferences()); setTagDrafts({}); }
   cache(comparison); setComparison(null); setConflict(false); setUnknown(null); setNotice(keep ? '已保留当前输入，请检查后手动保存。尺寸保存将新增一条记录。' : '已采用服务端资料。'); setError('');
 }
 useEffect(() => {
   if (initial.version === baseRef.current.version || lock.current || confirmed) return;
   setComparison(initial);
 }, [initial, confirmed]);
 return { baseline, name,setName,birthDate,setBirthDate,gender,setGender,values,setValues,preferences,setPreferences,tagDrafts,setTagDrafts,busy,notice,error,comparison,conflict,unknown,confirmed,basicDirty,sizesDirty,preferencesDirty,dirty,
   blocked:busy || !!comparison || conflict || !!unknown || !!confirmed,save,refresh,resolve,retry:() => {if(unknown) void run(unknown);},
 };
}
export type ProfileSession = ReturnType<typeof useProfileSession>;
