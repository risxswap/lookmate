import { ensureSession, getAccount } from '../../lib/auth';
import { request } from '../../lib/request';
import { errorMessage } from '../../lib/ui';
interface QrState {id:string;status:'PENDING'|'CONFIRMED'|'CANCELLED'|'EXPIRED'|'CONSUMED';expiresAt:string}
let timer:ReturnType<typeof setInterval>|undefined;
Page({
  data:{id:'',busy:false,error:'',status:'',accountName:'',expiresAt:'',seconds:0},
  onLoad(query:Record<string,string>){let id='';try{id=decodeURIComponent(query.scene||query.id||'');}catch{}this.setData({id});},
  async onShow(){await this.load();},
  onHide(){this.stop();},onUnload(){this.stop();},
  stop(){if(timer){clearInterval(timer);timer=undefined;}},
  async load(){
    this.stop();if(!this.data.id){this.setData({error:'登录码无效，请在网页刷新后重新扫描'});return;}
    this.setData({busy:true,error:''});
    try {const account=await ensureSession();this.setData({accountName:account.displayName||account.username||'微信用户'});const value=await request<QrState>(`/auth/wechat/qr/${encodeURIComponent(this.data.id)}`);this.setState(value);}
    catch(error){this.setData({error:errorMessage(error)});if(!getAccount())wx.navigateTo({url:'/pages/login/index'});}
    finally{this.setData({busy:false});}
  },
  setState(value:QrState){this.setData({status:value.status,expiresAt:value.expiresAt});this.tick();if(value.status==='PENDING')timer=setInterval(()=>this.tick(),1000);},
  tick(){const seconds=Math.max(0,Math.ceil((Date.parse(this.data.expiresAt)-Date.now())/1000));this.setData({seconds});if(!seconds&&this.data.status==='PENDING'){this.setData({status:'EXPIRED'});this.stop();}},
  async act(event:WechatMiniprogram.TouchEvent){if(this.data.busy||this.data.status!=='PENDING')return;const action=event.currentTarget.dataset.action as string;if(!['confirm','cancel'].includes(action))return;this.setData({busy:true,error:''});try{const value=await request<QrState>(`/auth/wechat/qr/${encodeURIComponent(this.data.id)}/${action}`,{method:'POST',body:{}});this.stop();this.setState(value);}catch(error){this.setData({error:errorMessage(error)});}finally{this.setData({busy:false});}},
  home(){wx.reLaunch({url:'/pages/home/index'});},
});
