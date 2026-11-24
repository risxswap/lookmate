import {api} from '../../lib/api';
import {request,ApiError} from '../../lib/request';
import {PagedList} from '../../features/account-list';
import {loadPickerPage, showPickerCovers, clearPickerCover, type PickerCover} from '../../features/picker-list';
import {requestKey,readStored,writeStored} from '../../lib/storage';
import {owner,stillOwner,action,Event,value,id,today,go} from '../../features/page';
import {confirm,toast} from '../../lib/ui';
import {monthRange,uuidKey,createPlan,outfitCoverId,assertAccount} from '../../features/outfits';
import type {OutfitPlan,Outfit,CreatePlan} from '../../types/api';
Page({
 data:{busy:false,error:'',date:today(),days:[] as {date:string;count:number;label:string}[],plans:[] as OutfitPlan[],total:0,more:false,editing:false,editId:'',editVersion:'',editDate:today(),scene:'',note:'',outfitId:'',outfitName:'暂不选择搭配',outfitChanged:false,outfits:[] as (Outfit & PickerCover & {scenesText:string})[],outfitMore:false,outfitCoverError:false,outfitPageError:'',showOutfits:false,pending:false},
 plans:new PagedList<OutfitPlan>(),outfits:new PagedList<Outfit>(),account:'',
 disposed:false, retryOverview:true,
 onLoad(query:Record<string,string>){
  this.plans = new PagedList<OutfitPlan>();
  this.outfits = new PagedList<Outfit>();
  this.setData({date:query.date||today(),editDate:query.date||today(),outfitId:query.outfitId||'',editing:!!query.outfitId,outfitChanged:!!query.outfitId});
 },
 onUnload(){this.disposed=true;},
 onShow(){void this.refresh();},onPullDownRefresh(){void this.refresh().finally(()=>wx.stopPullDownRefresh());},onReachBottom(){void this.load();},go,
 selectDateScope() {
  if (this.plans.selectScope(this.data.date)) {
   this.setData({plans:[], total:0, more:false});
  }
 },
 async refresh() {
  await action(this, async () => {
   this.selectDateScope();
   this.retryOverview = true;
   const account = await owner();
   if (!account || this.disposed) return;
   this.account = account;
   this.setData({pending:!!readStored<CreatePlan>('plan-pending',account)});
   if (this.data.outfitId && !this.data.editId) {
    const outfit = await api.outfit(this.data.outfitId);
    if (!stillOwner(account) || this.disposed) return;
    this.setData({outfitName:outfit.name});
   }
   const date = this.data.date;
   const range = monthRange(date);
   const result = await request<{days:{date:string;count:number}[]}>(`/outfit-plans/calendar?from=${range.from}&to=${range.to}`);
   if (!stillOwner(account) || this.disposed || date !== this.data.date) return;
   this.setData({days:result.days.map(day=>({...day,label:day.date.slice(5)}))});
   this.retryOverview = false;
   await this.readPlans(true);
  });
 },
 async readPlans(refresh:boolean) {
  this.selectDateScope();
  const date = this.data.date, account = this.account;
  await this.plans.load((page,size)=>api.plans(date,page,size), refresh);
  if (stillOwner(account) && !this.disposed && date === this.data.date) {
   this.setData({plans:this.plans.items,total:this.plans.total,more:this.plans.hasMore});
  }
 },
 async load(refresh=false) {
  if (this.retryOverview || !this.account) return this.refresh();
  await action(this, () => this.readPlans(refresh));
 },
 more(){return this.load();}, retry(){return this.load();},
 changeDate(e:Event){return this.chooseDate(value(e));},
 selectDay(e:Event){return this.chooseDate(id(e));},
 chooseDate(date:string){
  if(this.data.busy || date===this.data.date)return;
  const monthChanged = date.slice(0,7) !== this.data.date.slice(0,7);
  this.setData({date, ...(monthChanged ? {days:[]} : {})});
  return monthChanged ? this.refresh() : this.load(true);
 },
 newPlan(){this.setData({editing:true,editId:'',editVersion:'',editDate:this.data.date,scene:'',note:'',outfitId:'',outfitName:'暂不选择搭配',outfitChanged:false,showOutfits:false});},cancel(){this.setData({editing:false});},
 edit(e:Event){const p=this.data.plans.find(p=>p.id===id(e));if(p)this.setData({editing:true,editId:p.id,editVersion:p.version,editDate:p.date,scene:p.scene,note:p.note||'',outfitId:p.sourceOutfitId||'',outfitName:p.outfit?.name||'暂不选择搭配',outfitChanged:false,showOutfits:false});},
 field(e:Event){this.setData({[String(e.currentTarget.dataset.field)]:value(e)});},
 async chooseOutfits(){
  if(this.data.busy)return;
  this.setData({showOutfits:!this.data.showOutfits});
  if(this.data.showOutfits)await this.loadOutfits(true);
 },
 async loadOutfits(refresh=false){
  await action(this,()=>loadPickerPage(this.outfits,api.outfits,refresh,
   message=>{if(!this.disposed)this.setData({outfitPageError:message});},
   ()=>this.showOutfitCovers(refresh)));
 },
 async showOutfitCovers(retry:boolean){
  await showPickerCovers(this.outfits.items,outfitCoverId,()=>this.data.outfits,this.account,retry,(rows,failed)=>{
   if(!this.disposed)this.setData({
    outfits:rows.map(row=>({...row,scenesText:(row.scenes||[]).join(' · ')})),
    outfitMore:this.outfits.hasMore, outfitCoverError:failed
   });
  });
 },
 moreOutfits(){return this.loadOutfits();},
 retryOutfitCovers(){return action(this,()=>this.showOutfitCovers(true));},
 outfitCoverFailed(e:Event){
  if(!stillOwner(this.account))return;
  const rows=clearPickerCover(this.data.outfits,id(e),String(e.currentTarget.dataset.cover));
  if(rows)this.setData({outfits:rows,outfitCoverError:true});
 },
 selectOutfit(e:Event){const key=id(e),outfit=this.data.outfits.find(o=>o.id===key);this.setData({outfitId:key,outfitName:outfit?.name||'暂不选择搭配',outfitChanged:true,showOutfits:false});},
 async save(){if(this.data.pending&&!this.data.editId){toast('先处理上一次未确认的安排');return;}let saved=false;await action(this,async()=>{assertAccount(this.account);if(!this.data.scene.trim())throw new Error('请填写场景');if(this.data.editId){await request(`/outfit-plans/${this.data.editId}`,{method:'PATCH',body:{version:this.data.editVersion,date:this.data.editDate,scene:this.data.scene.trim(),note:this.data.note.trim()||null,...(this.data.outfitChanged?{outfitId:this.data.outfitId||null}:{})}});}else{const body:CreatePlan={clientRequestId:uuidKey(await requestKey()),date:this.data.editDate,scene:this.data.scene.trim(),note:this.data.note.trim()||null,outfitId:this.data.outfitId||null};await this.execute(body);}if(stillOwner(this.account))this.setData({date:this.data.editDate,editing:false});toast('安排已保存');saved=true;});if(saved)await this.refresh();},
 async execute(body:CreatePlan){assertAccount(this.account);writeStored('plan-pending',body,this.account);this.setData({pending:true});try{await createPlan(body);writeStored('plan-pending',null,this.account);if(stillOwner(this.account))this.setData({pending:false});}catch(error){if(error instanceof ApiError&&error.status>=400&&error.status<500&&![408,429].includes(error.status)){writeStored('plan-pending',null,this.account);if(stillOwner(this.account))this.setData({pending:false});}throw error;}},
 async resend(){if(!await confirm('使用原请求标识恢复上一次安排？若已保存，服务端会返回原安排，不重复创建。'))return;let saved=false;await action(this,async()=>{assertAccount(this.account);const pending=readStored<CreatePlan>('plan-pending',this.account);if(pending){await this.execute(pending);if(stillOwner(this.account))this.setData({date:pending.date,editing:false});toast('安排已恢复');saved=true;}});if(saved)await this.refresh();},
 async remove(e:Event){const plan=this.data.plans.find(p=>p.id===id(e));if(!plan||!await confirm('删除这条穿搭安排？常用搭配仍会保留。'))return;let saved=false;await action(this,async()=>{assertAccount(this.account);await request(`/outfit-plans/${plan.id}?version=${plan.version}`,{method:'DELETE'});saved=true;});if(saved)await this.refresh();}
});
