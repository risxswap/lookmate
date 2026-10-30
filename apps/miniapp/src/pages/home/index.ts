import {api} from '../../lib/api';
import {owner,stillOwner,action,today,go,Event,value,statusLabel,isActive} from '../../features/page';
import {outfitCards} from '../../features/outfits';
import type {OutfitPlan,TaskSummary} from '../../types/api';
Page({
 data:{busy:false,error:'',date:today(),plans:[] as OutfitPlan[],planTotal:0,outfits:[] as Awaited<ReturnType<typeof outfitCards>>,active:null as TaskSummary|null,statusLabel},
 visible:false,timer:0,
 onShow(){this.visible=true;void this.refresh();},onHide(){this.visible=false;clearTimeout(this.timer);},onUnload(){this.visible=false;clearTimeout(this.timer);},
 onPullDownRefresh(){void this.refresh().finally(()=>wx.stopPullDownRefresh());},
 async refresh(){await action(this,async()=>{const account=await owner();if(!account)return;const date=this.data.date;const [plans,outfits,workspace]=await Promise.all([api.plans(date,1,5),api.outfits(1,4),api.workspace()]);const cards=await outfitCards(outfits.items);if(!stillOwner(account)||date!==this.data.date)return;this.setData({plans:plans.items,planTotal:plans.total,outfits:cards,active:workspace.activeTask});clearTimeout(this.timer);if(this.visible&&workspace.activeTask&&isActive(workspace.activeTask.status))this.timer=setTimeout(()=>void this.refresh(),5000);});},
 changeDate(e:Event){if(this.data.busy)return;this.setData({date:value(e)});void this.refresh();},go,
 calendar(){wx.navigateTo({url:`/pages/calendar/index?date=${this.data.date}`});},
 task(){const t=this.data.active;if(t)wx.navigateTo({url:t.outfitId?`/pages/outfit-detail/index?id=${t.outfitId}`:`/pages/design-detail/index?id=${t.id}`});},
 design(){wx.switchTab({url:'/pages/design/index'});}
});
