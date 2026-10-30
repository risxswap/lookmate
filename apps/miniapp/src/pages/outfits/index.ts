import {api} from '../../lib/api';
import {request} from '../../lib/request';
import {PagedList} from '../../lib/pagination';
import {owner,stillOwner,action,Event,value,id,go} from '../../features/page';
import {confirm,toast} from '../../lib/ui';
import {outfitCards,assertAccount} from '../../features/outfits';
import type {Outfit,OutfitGroup} from '../../types/api';
Page({
 data:{busy:false,error:'',items:[] as Awaited<ReturnType<typeof outfitCards>>,groups:[] as OutfitGroup[],groupId:'',scene:'',total:0,more:false,groupMore:false,groupName:'',editGroupId:'',editGroupVersion:''},
 account:'',rows:new PagedList<Outfit>(),groupRows:new PagedList<OutfitGroup>(),
 onShow(){void this.refresh();},onPullDownRefresh(){void this.refresh().finally(()=>wx.stopPullDownRefresh());},onReachBottom(){void this.load(false);},
 async refresh(){await this.load(true);if(!this.data.error)await this.groups(true);},
 async load(refresh=false){await action(this,async()=>{const account=await owner();if(!account)return;this.account=account;await this.rows.load((p,s)=>api.outfits(p,s,{groupId:this.data.groupId,scene:this.data.scene}),refresh);const items=await outfitCards(this.rows.items);if(stillOwner(account))this.setData({items,total:this.rows.total,more:this.rows.hasMore});});},
 async groups(refresh=false){await action(this,async()=>{const account=await owner();if(!account)return;this.account=account;await this.groupRows.load(api.outfitGroups,refresh);if(stillOwner(account))this.setData({groups:this.groupRows.items,groupMore:this.groupRows.hasMore});});},
 moreGroups(){void this.groups();},more(){void this.load();},go,
 filter(e:Event){if(this.data.busy)return;this.setData({groupId:id(e)});void this.load(true);},scene(e:Event){if(this.data.busy)return;this.setData({scene:value(e)});},applyScene(){if(this.data.busy)return;void this.load(true);},
 groupName(e:Event){this.setData({groupName:value(e)});},
 editGroup(e:Event){const group=this.data.groups.find(g=>g.id===id(e));if(group)this.setData({editGroupId:group.id,editGroupVersion:group.version,groupName:group.name});},
 cancelGroup(){this.setData({editGroupId:'',editGroupVersion:'',groupName:''});},
 async saveGroup(){let saved=false;await action(this,async()=>{assertAccount(this.account);if(!this.data.groupName.trim())throw new Error('请输入分组名称');await request(this.data.editGroupId?`/outfit-groups/${this.data.editGroupId}`:'/outfit-groups',{method:this.data.editGroupId?'PATCH':'POST',body:{name:this.data.groupName.trim(),...(this.data.editGroupId?{version:this.data.editGroupVersion}:{})}});this.cancelGroup();toast('分组已保存');saved=true;});if(saved)await this.groups(true);},
 async deleteGroup(e:Event){const group=this.data.groups.find(g=>g.id===id(e));if(!group||!await confirm(`删除分组“${group.name}”？组内搭配会保留。`))return;let saved=false;await action(this,async()=>{assertAccount(this.account);await request(`/outfit-groups/${group.id}?version=${group.version}`,{method:'DELETE'});if(this.data.groupId===group.id)this.setData({groupId:''});saved=true;});if(saved)await this.refresh();}
});
