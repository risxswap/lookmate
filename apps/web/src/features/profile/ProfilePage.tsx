import { Feedback } from '../../components/Feedback';
import { PageHeading } from '../../components/PageHeading';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Input, Modal, Radio, Skeleton, Tabs } from 'antd';
import { BirthDateInput } from './BirthDateInput';
import { isCalendarDate } from './birthDate';
import type { Account } from '../../api/client';
import { replaceTab, setNavigationGuard, useLocation } from '../../app/navigation';
import { QueryFailure } from '../workspace/TaskViews';
import { emptyMeasurements, measurementGroups, measurementValues, useProfile, type MeasurementKey, type Profile } from './queries';
import { cleanPreferences, count, preferenceErrors } from './preferences';
import { useProfileSession } from './useProfileSession';
import { ProfilePhotos } from './ProfilePhotos';
import { ProfilePreferences } from './ProfilePreferences';
import { ProfileMeasurements } from './ProfileMeasurements';
import { ProfileFeedback } from './ProfileFeedback';
import './ProfileEditor.css';
function Editor({profile,tab}:{profile:Profile;tab:string}) {
 const [photoDirty,setPhotoDirty]=useState(false);const [photoBusy,setPhotoBusy]=useState(false);
 const s=useProfileSession(profile,photoDirty); const [validation,setValidation]=useState('');const [focusError,setFocusError]=useState<{key:MeasurementKey;attempt:number}>();
 const [modal,holder]=Modal.useModal();
 const entry=useRef('');
 useEffect(()=>{if(tab!=='measurements'){entry.current=tab;return;}if(entry.current!==tab&&!s.blocked){if(!s.gender)s.setGender('FEMALE');entry.current=tab;}},[tab,s.gender,s.blocked,s.setGender]);
 const dirty=s.dirty||photoDirty||s.busy||!!s.unknown||!!s.confirmed;
 useEffect(()=>{
   const pathname=window.location.pathname;
   const cleanup=setNavigationGuard(url=>url.pathname===pathname||!dirty||window.confirm('有未保存的修改或待确认操作。离开会丢失本页草稿，确定离开？'));
   const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};
   window.addEventListener('beforeunload',warn);return()=>{cleanup();window.removeEventListener('beforeunload',warn);};
 },[dirty]);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function saveBasic(){const name=s.name.trim();if(count(name)>64){setValidation('昵称最多 64 个字符。');document.getElementById('profile-display-name')?.focus();return;}if(s.birthDate&&(!isCalendarDate(s.birthDate)||s.birthDate>today)){setValidation('请选择 1000-01-01 至今天之间的有效出生日期。');return;}setValidation('');s.save({path:'/profile',method:'PATCH',scope:'basic',body:{displayName:name||null,birthDate:s.birthDate||null,gender:s.gender}});}
 function savePreferences(){if(Object.values(s.tagDrafts).some(Boolean)){setValidation('有尚未添加的标签文字，请先添加或清除。');return;}const errors=preferenceErrors(s.preferences);if(errors.length){setValidation(errors.join(' '));return;}setValidation('');s.save({path:'/profile/preferences',method:'PATCH',scope:'preferences',body:{...cleanPreferences(s.preferences)}});}
 function saveMeasurements(){const invalid=measurementGroups.flatMap(g=>g.fields.map(([key,label])=>({key,label}))).find(({key})=>{const v=s.values[key];return v!==null&&(!Number.isFinite(v)||v<=0||v>9999.99||Math.abs(v*100-Math.round(v*100))>0.000001);});if(invalid){setValidation(`${invalid.label}：请输入大于 0、不超过 9999.99 且最多两位小数的数值。`);setFocusError({key:invalid.key,attempt:Date.now()});return;}if(!s.gender){setValidation('请选择性别。');return;}setValidation('');const commit=()=>s.save({path:'/profile/measurements',method:'POST',scope:'measurements',body:{gender:s.gender,...s.values}});if(Object.values(s.values).every(v=>v===null))modal.confirm({title:'保存全空尺寸？',content:'将新增一条全空记录并设为当前，后续按无有效尺寸处理。',okText:'保存',cancelText:'继续填写',onOk:commit});else commit();}
 function replaceSizes(clear:boolean){const action=()=>s.setValues(clear?emptyMeasurements():measurementValues(s.baseline.currentMeasurement));if(s.sizesDirty)modal.confirm({title:clear?'清空尺寸？':'恢复当前尺寸？',content:'未保存的尺寸修改将被替换，性别保持不变。',okText:'确认',cancelText:'继续编辑',onOk:action});else action();}
 const currentDirty=tab==='preferences'?s.preferencesDirty:tab==='measurements'?s.sizesDirty||s.genderDirty:s.basicDirty;
 return <div className="profile-editor">{holder}<ProfileFeedback session={s}/><Tabs tabBarExtraContent={tab === 'photos' ? undefined : <Button loading={s.busy} disabled={s.busy||photoBusy} onClick={()=>void s.refresh(tab)}>刷新{tab==='photos'?'我的照片':tab==='measurements'?'身体尺寸':tab==='preferences'?'兴趣与偏好':'基础资料'}</Button>} activeKey={tab} onChange={key=>{setValidation('');replaceTab(key);}} items={[
 {key:'basic',label:'基础资料',forceRender:true,children:<div className="pp-basic"><div className="pp-field"><label htmlFor="profile-username">用户名</label><Input id="profile-username" value={profile.username} readOnly/></div><div className="pp-field"><label htmlFor="profile-display-name">昵称</label><Input id="profile-display-name" value={s.name} disabled={s.blocked} allowClear onChange={e=>s.setName(e.target.value)}/><small>可留空，最多 64 个字符</small></div><div className="pp-field"><span>性别</span><Radio.Group aria-label="基础资料性别" value={s.gender??'FEMALE'} disabled={s.blocked} options={[{label:'女',value:'FEMALE'},{label:'男',value:'MALE'}]} onChange={e=>s.setGender(e.target.value)}/><small>与身体尺寸共用同一份性别资料</small></div><div className="pp-field"><label htmlFor="profile-birth-date">出生日期</label><BirthDateInput value={s.birthDate} today={today} disabled={s.blocked} onChange={s.setBirthDate}/></div></div>},
 {key:'photos',label:'我的照片',forceRender:true,children:<ProfilePhotos profile={s.baseline} session={s} onDirty={setPhotoDirty} onBusy={setPhotoBusy}/>},
 {key:'measurements',label:'身体尺寸',forceRender:true,children:<ProfileMeasurements session={s} focusError={focusError}/>},
 {key:'preferences',label:'兴趣与偏好',forceRender:true,children:<ProfilePreferences session={s}/>},
 ]}/>{validation&&<Feedback type="error" title={validation}/ >}{tab!=='photos'&&<footer className="pp-savebar"><div aria-live="polite"><strong>{currentDirty?'有未保存的修改':'当前没有未保存的修改'}</strong><small>各标签分别保存，切换标签保留输入。</small></div><div className="pp-save-actions">{tab==='measurements'&&<><Button disabled={s.blocked} onClick={()=>replaceSizes(false)}>恢复当前尺寸</Button><Button disabled={s.blocked} onClick={()=>replaceSizes(true)}>清空尺寸</Button></>}<Button type="primary" loading={s.busy} disabled={s.blocked||(tab==='preferences'&&preferenceErrors(s.preferences).length>0)} onClick={tab==='preferences'?savePreferences:tab==='measurements'?saveMeasurements:saveBasic}>{tab==='preferences'?'保存偏好':tab==='measurements'?'保存为新记录':'保存资料'}</Button></div></footer>}</div>;
}
export function ProfilePage({account}:{account:Account}){
 const query=useProfile(account.id);const value=useLocation().searchParams.get('tab');const tab=value&&['basic','photos','measurements','preferences'].includes(value)?value:'basic';
 return <><PageHeading title="从了解自己开始" description="你的资料、照片、尺寸与偏好，为个人形象设计提供参考。" />{query.isError&&<QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={()=>void query.refetch()}/>}<Card>{query.isPending?<Skeleton active/>:query.data?<Editor key={account.id} profile={query.data} tab={tab}/>:<p>个人资料读取失败，请重试。</p>}</Card></>;
}
